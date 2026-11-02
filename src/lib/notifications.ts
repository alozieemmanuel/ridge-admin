import { prisma } from "@/lib/prisma";
import { getSettingsMap, mergeTemplate, buildWhatsAppUrl } from "@/lib/settings";
import { BASE_PATH } from "@/lib/basePath";
import { firstEventId } from "@/lib/event";
import { after } from "next/server";
import { renderBrandedEmail, emailBrand, renderReceiptEmail, renderTicketEmail, sendEmail, escapeHtml, isValidEmailAddress, appBaseUrl } from "@/lib/email";
import { makeProofToken, makeReserveToken } from "@/lib/proof-token";
import { defaultTemplate } from "@/lib/emailDefaults";
import { ticketQrPng } from "@/lib/ticket";
import type { GmailAttachment } from "@/lib/gmail";
import type { SendEmailResult, EmailKind, ReceiptLine, SummaryBlock } from "@/lib/email";
import { buildReceiptLines, buildLedgerLines, paidText, usdText } from "@/lib/receipt";
import type { Registration, BrochureRequest } from "@prisma/client";

type Settings = Record<string, string>;
type EventSource = "REGISTRATION" | "BROCHURE" | "CAMPAIGN";

interface BuiltEmail {
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: GmailAttachment[];
}

function firstNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "there";
}

async function getTemplate(eventId: string, key: string) {
  const template = await prisma.emailTemplate.findUnique({ where: { eventId_key: { eventId, key } } });
  if (!template) {
    // The invitation and reminder wording has built-in defaults, so they work before the seed has run.
    const fallback = defaultTemplate(key);
    if (fallback) return { key: fallback.key, subject: fallback.subject, body: fallback.body, replyTo: fallback.replyTo as string | null };
    throw new Error(
      `Email template "${key}" is missing. Run the seed script (npm run seed) to create default templates.`
    );
  }
  return template;
}

/**
 * A template's Reply-To can contain {{tokens}} (the seeded default is
 * {{contact_email}}). Those must be merged BEFORE sending — the email providers reject a
 * literal "{{contact_email}}" as an invalid address, which fails the whole email.
 * Empty means "reply to the sending address"; an unusable value is dropped
 * (and logged) rather than blocking the email.
 */
function resolveReplyTo(raw: string | null | undefined, vars: Settings): string | undefined {
  const merged = raw ? mergeTemplate(raw, vars).trim() : "";
  if (!merged) return undefined;
  if (isValidEmailAddress(merged)) return merged;
  console.warn(`[email] Ignoring invalid Reply-To "${merged}" — check the template's Reply-To field.`);
  return undefined;
}

async function recordEvent(params: {
  source: EventSource;
  audience: "ATTENDEE" | "INTERNAL";
  id: string;
  type: "SENT" | "FAILED";
  kind?: EmailKind;
  provider?: "GMAIL" | "BREVO" | "MAILERSEND" | "MAILCHIMP";
  subject?: string;
  providerMessageId?: string;
  errorMessage?: string;
  campaignId?: string;
}) {
  await prisma.emailEvent.create({
    data: {
      source: params.source,
      audience: params.audience,
      registrationId: params.source === "REGISTRATION" || params.source === "CAMPAIGN" ? params.id : undefined,
      brochureRequestId: params.source === "BROCHURE" ? params.id : undefined,
      campaignId: params.campaignId,
      kind: params.kind,
      provider: params.provider,
      subject: params.subject?.slice(0, 300),
      type: params.type,
      providerMessageId: params.providerMessageId,
      errorMessage: params.errorMessage ? params.errorMessage.slice(0, 500) : undefined,
    },
  });
}

/**
 * Builds + sends one attendee-facing email and ALWAYS records the outcome.
 * Anything that goes wrong while building it (e.g. a missing template) is
 * recorded as FAILED with the reason, so the dashboard shows "Failed" and why,
 * instead of a silent "Not sent".
 *
 * `kind` picks the channel: "campaign" goes through Brevo, everything else
 * goes through Gmail (see sendEmail in email.ts).
 */
/** Runs `task` after the response has gone out (single sends), or before returning (bulk work, where the count must be right). */
async function runAfterResponse(task: () => Promise<unknown>, later: boolean): Promise<void> {
  if (later) {
    try {
      after(() => task().catch((err) => console.error("[email] Could not record the email event:", err)));
      return;
    } catch {
      // not inside a request (a script or a cron): fall through and wait for it
    }
  }
  await task();
}

async function deliverAttendeeEmail(opts: {
  source: EventSource;
  kind: EmailKind;
  id: string;
  to: string;
  campaignId?: string;
  build: () => Promise<BuiltEmail>;
}): Promise<SendEmailResult> {
  // A contact added without an email (allowed for some events) can never be emailed. Nothing is recorded, because nothing was attempted.
  if (!opts.to?.trim()) return { success: false, error: "This contact has no email address." };
  let result: SendEmailResult;
  let subject: string | undefined;
  try {
    const email = await opts.build();
    subject = email.subject;
    result = await sendEmail({
      kind: opts.kind,
      to: opts.to,
      subject: email.subject,
      html: email.html,
      replyTo: email.replyTo,
      attachments: email.attachments,
      tags: [
        { name: "source", value: opts.source === "BROCHURE" ? "brochure" : opts.source === "CAMPAIGN" ? "campaign" : "registration" },
        { name: "id", value: opts.id },
        ...(opts.campaignId ? [{ name: "campaign", value: opts.campaignId }] : []),
      ],
    });
  } catch (err) {
    result = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Every sender is at its daily limit: nothing happened, so nothing is recorded. The caller queues it for tomorrow.
  if (result.deferred) return result;

  // Writing the record is not needed to answer, so it runs after the response where Next allows it.
  const write = () =>
    recordEvent({
      source: opts.source,
      audience: "ATTENDEE",
      id: opts.id,
      type: result.success ? "SENT" : "FAILED",
      kind: opts.kind,
      provider: result.provider,
      subject,
      providerMessageId: result.providerMessageId,
      errorMessage: result.error,
      campaignId: opts.campaignId,
    });
  await runAfterResponse(write, opts.kind !== "campaign");
  return result;
}

function throwIfFailed(result: SendEmailResult): void {
  if (!result.success) throw new Error(result.error || "Failed to send email.");
}

// ---------------------------------------------------------------------------
// Internal team notifications — built into the system, not admin-editable.
// The recipient comes from the "Internal Notification Email" setting
// (leave it empty to switch these alerts off).
// ---------------------------------------------------------------------------

function renderInternalEmail(heading: string, rows: [string, string | null | undefined][]): string {
  const body = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 18px 6px 0;color:#666;vertical-align:top;white-space:nowrap;">${escapeHtml(
          label
        )}</td><td style="padding:6px 0;">${escapeHtml(value || "-")}</td></tr>`
    )
    .join("");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;">
    <p style="margin:0 0 12px;font-size:16px;font-weight:bold;">${escapeHtml(heading)}</p>
    <table style="border-collapse:collapse;">${body}</table>
  </div>`;
}

/** Best-effort: an internal alert failing must never affect the attendee or the caller. */
async function sendInternalNotification(opts: {
  source: EventSource;
  id: string;
  settings: Settings;
  subject: string;
  rows: [string, string | null | undefined][];
  replyTo?: string;
}): Promise<void> {
  const to = opts.settings.notification_email?.trim();
  if (!to) return;

  let result: SendEmailResult;
  try {
    result = await sendEmail({
      kind: "internal",
      to,
      subject: opts.subject,
      html: renderInternalEmail(opts.subject, opts.rows),
      replyTo: opts.replyTo,
    });
  } catch (err) {
    result = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    await recordEvent({
      source: opts.source,
      audience: "INTERNAL",
      id: opts.id,
      type: result.success ? "SENT" : "FAILED",
      kind: "internal",
      providerMessageId: result.providerMessageId,
      errorMessage: result.error,
    });
  } catch (err) {
    console.error("[email] Could not record internal notification event:", err);
  }
}

// ---------------------------------------------------------------------------
// Attendee email builders
// ---------------------------------------------------------------------------

function registrationVars(registration: Registration, settings: Settings): Settings {
  return {
    first_name: firstNameOf(registration.fullName),
    full_name: registration.fullName,
    email: registration.email,
    phone: registration.phone,
    country: registration.country,
    notes: registration.notes || "-",
    reg_type_label: registration.regType === "LATE" ? "Late Registration" : "Early Bird",
    fee_label: registration.regType === "LATE" ? settings.late_registration_fee : settings.registration_fee,
    registration_id: registration.id,
    ...settings,
  };
}

/** Link to the payment page for this person, with their secure token so the page can pick up where they left off. */
export function paymentPageLink(registration: Registration, settings: Settings): string {
  const base = (settings.payment_page_url || "https://example.com/register").trim();
  return `${base}${base.includes("?") ? "&" : "?"}pay=${encodeURIComponent(makeProofToken(registration.id))}`;
}

async function buildRegistrationConfirmation(registration: Registration, settings: Settings): Promise<BuiltEmail> {
  const vars = registrationVars(registration, settings);
  const template = await getTemplate(registration.eventId, "registration_confirmation");
  const subject = mergeTemplate(template.subject, vars);
  const bodyText = mergeTemplate(template.body, vars);

  const html = renderBrandedEmail({
        brand: emailBrand(settings),
    eyebrow: settings.event_caption,
    heading: subject,
    bodyText,
    summaryBlocks: [
      {
        heading: "Registration Summary",
        rows: [
          ["Name", registration.fullName],
          ["Email", registration.email],
          ["Registration Fee", vars.fee_label],
          ["Cohort", settings.cohort_dates],
        ],
      },
    ],
    ctaLabel: "Contact The Team",
    ctaUrl: buildWhatsAppUrl(settings.contact_whatsapp_number, settings.contact_whatsapp_message),
  });

  return { subject, html, replyTo: resolveReplyTo(template.replyTo, vars) };
}

async function buildBrochureEmail(brochureRequest: BrochureRequest, settings: Settings): Promise<BuiltEmail> {
  const vars: Settings = {
    first_name: firstNameOf(brochureRequest.fullName),
    full_name: brochureRequest.fullName,
    email: brochureRequest.email,
    ...settings,
  };
  const template = await getTemplate(settings.event_id, "brochure_confirmation");
  const subject = mergeTemplate(template.subject, vars);
  const bodyText = mergeTemplate(template.body, vars);

  const html = renderBrandedEmail({
        brand: emailBrand(settings),
    eyebrow: settings.cohort_dates,
    heading: subject,
    bodyText,
    summaryBlocks: [
      {
        heading: "At A Glance",
        rows: [
          ["Registration Fee", settings.registration_fee],
          ["Early Bird Closes", settings.early_bird_deadline],
          ["Cohort", settings.cohort_dates],
        ],
      },
    ],
    ctaLabel: "Download The Brochure",
    ctaUrl: settings.brochure_url,
  });

  return { subject, html, replyTo: resolveReplyTo(template.replyTo, vars) };
}

async function buildPaymentReminder(registration: Registration, settings: Settings): Promise<BuiltEmail> {
  const vars = registrationVars(registration, settings);
  const template = await getTemplate(registration.eventId, "payment_reminder");
  const subject = mergeTemplate(template.subject, vars);
  const bodyText = mergeTemplate(template.body, vars);

  const html = renderBrandedEmail({
        brand: emailBrand(settings),
    eyebrow: settings.event_caption,
    heading: subject,
    bodyText,
    ctaLabel: "Complete My Payment",
    ctaUrl: paymentPageLink(registration, settings),
  });

  return { subject, html, replyTo: resolveReplyTo(template.replyTo, vars) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** New registration: attendee confirmation + internal team alert. Never throws for a failed send — the outcome is recorded. */
export async function sendRegistrationEmails(registration: Registration): Promise<void> {
  const settings = await getSettingsMap(registration.eventId);

  await deliverAttendeeEmail({
    source: "REGISTRATION",
    kind: "confirmation",
    id: registration.id,
    to: registration.email,
    build: () => buildRegistrationConfirmation(registration, settings),
  });

  await sendInternalNotification({
    source: "REGISTRATION",
    id: registration.id,
    settings,
    subject: `New registration: ${registration.fullName}`,
    replyTo: registration.email,
    rows: [
      ["Name", registration.fullName],
      ["Email", registration.email],
      ["Phone", registration.phone],
      ["Country", registration.country],
      ["Registration type", registration.regType === "LATE" ? "Late Registration" : "Early Bird"],
      ["Notes", registration.notes],
    ],
  });
}

/** New brochure request: brochure email + internal team alert. Never throws for a failed send — the outcome is recorded. */
export async function sendBrochureEmails(brochureRequest: BrochureRequest): Promise<void> {
  const settings = await getSettingsMap(await firstEventId());

  await deliverAttendeeEmail({
    source: "BROCHURE",
    kind: "brochure",
    id: brochureRequest.id,
    to: brochureRequest.email,
    build: () => buildBrochureEmail(brochureRequest, settings),
  });

  await sendInternalNotification({
    source: "BROCHURE",
    id: brochureRequest.id,
    settings,
    subject: `New brochure request: ${brochureRequest.fullName}`,
    replyTo: brochureRequest.email,
    rows: [
      ["Name", brochureRequest.fullName],
      ["Email", brochureRequest.email],
    ],
  });
}

/** Admin action: re-send just the attendee confirmation. Throws (with the reason) if it fails. */
export async function resendRegistrationConfirmation(registration: Registration): Promise<void> {
  const settings = await getSettingsMap(registration.eventId);
  throwIfFailed(
    await deliverAttendeeEmail({
      source: "REGISTRATION",
      kind: "confirmation",
      id: registration.id,
      to: registration.email,
      build: () => buildRegistrationConfirmation(registration, settings),
    })
  );
}

/** Admin action: re-send just the brochure email. Throws (with the reason) if it fails. */
export async function resendBrochureConfirmation(brochureRequest: BrochureRequest): Promise<void> {
  const settings = await getSettingsMap(await firstEventId());
  throwIfFailed(
    await deliverAttendeeEmail({
      source: "BROCHURE",
      kind: "brochure",
      id: brochureRequest.id,
      to: brochureRequest.email,
      build: () => buildBrochureEmail(brochureRequest, settings),
    })
  );
}

/** Admin action: a payment reminder for anyone not fully paid. */
export async function sendPaymentReminder(registration: Registration): Promise<void> {
  const settings = await getSettingsMap(registration.eventId);
  throwIfFailed(
    await deliverAttendeeEmail({
      source: "REGISTRATION",
      kind: "payment_reminder",
      id: registration.id,
      to: registration.email,
      build: () => buildPaymentReminder(registration, settings),
    })
  );
}

/**
 * Sends one Campaigns-page broadcast email to a single registration. Subject
 * and body come from the admin's compose form (not an EmailTemplate row) and
 * support the same {{first_name}} / {{full_name}} / Settings merge vars.
 * Never throws — the outcome (sent/failed) is recorded and returned so the
 * caller can tally results across the whole audience.
 *
 * This is the only path that uses Brevo (kind: "campaign").
 */
export async function sendCampaignEmail(
  registration: Registration,
  subject: string,
  bodyText: string,
  settings: Settings,
  campaignId?: string,
  ctaLabel?: string | null
): Promise<SendEmailResult> {
  // {{reserve_link}} works in the text, and ctaLabel adds a button, both with this guest's own link.
  const link = reserveLink(registration, settings.event_slug);
  const vars = { ...registrationVars(registration, settings), reserve_link: link };
  const mergedSubject = mergeTemplate(subject, vars);
  const mergedBody = mergeTemplate(bodyText, vars);

  return deliverAttendeeEmail({
    source: "CAMPAIGN",
    kind: "campaign",
    id: registration.id,
    to: registration.email,
    campaignId,
    build: async () => ({
      subject: mergedSubject,
      html: renderBrandedEmail({
        brand: emailBrand(settings),
        eyebrow: settings.event_caption,
        heading: mergedSubject,
        bodyText: mergedBody,
        ...(ctaLabel ? { ctaLabel, ctaUrl: link } : {}),
      }),
    }),
  });
}

/**
 * The email for a Mailchimp campaign. Mailchimp sends one email to everyone, so the parts that differ by person become
 * Mailchimp merge tags (*|FNAME|* and so on) that Mailchimp fills in for each guest.
 */
export function buildMailchimpCampaignEmail(settings: Settings, subject: string, bodyText: string, ctaLabel?: string | null): { subject: string; html: string } {
  const vars: Settings = {
    ...settings,
    first_name: "*|FNAME|*",
    full_name: "*|FNAME|* *|LNAME|*",
    email: "*|EMAIL|*",
    phone: "*|PHONE|*",
    reserve_link: "*|RSVLINK|*",
  };
  const mergedSubject = mergeTemplate(subject, vars);
  const mergedBody = mergeTemplate(bodyText, vars);
  return {
    subject: mergedSubject,
    // The sender-name comment at the front is only for our own senders, so it is dropped here.
    html: renderBrandedEmail({
      brand: emailBrand(settings),
      eyebrow: settings.event_caption,
      heading: mergedSubject,
      bodyText: mergedBody,
      ...(ctaLabel ? { ctaLabel, ctaUrl: "*|RSVLINK|*" } : {}),
    }).replace(/^<!--from:[^>]*?-->/, ""),
  };
}

/**
 * Sends a test of a campaign to one address the admin typed, so they can see the real email before it goes to everyone.
 * It uses the same sender, layout and merge values as the real send (the name is the admin's own), is marked [TEST] in the
 * subject, and is not recorded against any contact or campaign.
 */
export async function sendCampaignTest(opts: { to: string; subject: string; bodyText: string; settings: Settings; sampleName: string; ctaLabel?: string }): Promise<SendEmailResult> {
  const vars: Settings = {
    first_name: firstNameOf(opts.sampleName),
    full_name: opts.sampleName,
    email: opts.to,
    phone: "",
    reserve_link: `${appBaseUrl()}${BASE_PATH}/${opts.settings.event_slug}/reserve?t=TEST-LINK-NOT-ACTIVE`,
    ...opts.settings,
  };
  const subject = mergeTemplate(opts.subject, vars);
  const body = mergeTemplate(opts.bodyText, vars);
  try {
    return await sendEmail({
      kind: "campaign",
      to: opts.to,
      subject: `[TEST] ${subject}`,
      html: renderBrandedEmail({ brand: emailBrand(opts.settings), eyebrow: opts.settings.event_caption, heading: subject, bodyText: body, ...(opts.ctaLabel ? { ctaLabel: opts.ctaLabel, ctaUrl: vars.reserve_link } : {}) }),
      tags: [{ name: "source", value: "campaign-test" }],
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Admin action: tells the participant their payment has been confirmed. Only
 * ever sent from the admin side after an admin approves a payment. A receipt
 * upload on the public site does NOT email the participant.
 * Throws (with the reason) if the send fails. Does nothing for a not-paid registration.
 */
export async function sendPaymentConfirmation(registration: Registration): Promise<void> {
  if (registration.paymentStatus === "NOT_PAID") return;
  const settings = await getSettingsMap(registration.eventId);
  const feeRaw = parseFloat(
    registration.regType === "LATE" ? settings.late_registration_fee_amount : settings.registration_fee_amount
  );
  const fee = Number.isFinite(feeRaw) ? feeRaw : null;
  const first = firstNameOf(registration.fullName);
  const paidInFull = registration.paymentStatus === "PAID";
  const balance = fee !== null ? Math.max(0, fee - registration.amountPaid) : null;

  // Payments an admin recorded, each in the currency it was actually received in. Registrations
  // confirmed before payments were recorded this way fall back to the receipts the participant uploaded.
  const records = await prisma.paymentRecord.findMany({
    where: { registrationId: registration.id },
    orderBy: { receivedAt: "asc" },
  });

  let lines: ReceiptLine[];
  let anyForeign: boolean;
  if (records.length > 0) {
    ({ lines, anyForeign } = buildLedgerLines(records, registration.amountPaid));
  } else {
    // The USD equivalent of an uploaded receipt uses the rate implied by the fee the participant was quoted.
    const proofs = await prisma.paymentProof.findMany({
      where: { registrationId: registration.id, status: "APPROVED" },
      orderBy: { createdAt: "asc" },
    });
    ({ lines, anyForeign } = buildReceiptLines(proofs, fee, registration.amountPaid, registration.paymentUpdatedAt));
  }
  const latest = records.length > 0 ? records[records.length - 1] : null;
  const latestText = latest ? `${paidText(latest.currency, latest.amount)}, which is ${usdText(latest.usdAmount)}` : usdText(registration.amountPaid);

  const issued = registration.paymentUpdatedAt ?? new Date();
  const receiptNo = `RCT-${issued.toISOString().slice(0, 10).replace(/-/g, "")}-${registration.id.slice(-5).toUpperCase()}`;

  const subject = paidInFull ? "Your payment is confirmed" : "We've received your part payment";
  const intro = paidInFull
    ? latest
      ? `Hi ${first},\n\nWe've confirmed your payment of ${latestText} for ${settings.programme_name}. Your registration is now paid in full, and your receipt is below. Thank you.\n\nOur team will send you a link to choose your seat for Day 7.`
      : `Hi ${first},\n\nWe've confirmed your payment in full for ${settings.programme_name}. Your receipt is below. Thank you.\n\nOur team will send you a link to choose your seat for Day 7.`
    : `Hi ${first},\n\nWe've confirmed your payment of ${latestText} for ${settings.programme_name}. Your receipt is below.${
        balance !== null && balance > 0 ? ` The remaining balance is ${usdText(balance)}, which you can pay using the details in your registration email.` : ""
      }\n\nOnce the balance is settled we'll send you a link to choose your seat.`;

  const footnote = anyForeign
    ? "Payments made in another currency are converted to USD at the rate shown, which is based on the registration fee quoted to you in that currency. Total paid is the amount confirmed by Investor Hangout."
    : "Total paid is the amount confirmed by Investor Hangout.";

  throwIfFailed(
    await deliverAttendeeEmail({
      source: "REGISTRATION",
      kind: "payment_confirmation",
      id: registration.id,
      to: registration.email,
      build: async () => ({
        subject,
        html: renderReceiptEmail({
        brand: emailBrand(settings),
          eyebrow: "Payment Receipt",
          heading: subject,
          intro,
          receiptNo,
          issuedOn: formatLongDate(issued),
          paidInFull,
          billedTo: {
            name: registration.fullName,
            email: registration.email,
            phone: registration.phone,
            country: registration.country,
          },
          forWhat: {
            programme: settings.programme_name,
            registrationType: registration.regType === "LATE" ? "Late" : "Early Bird",
            dates: settings.cohort_dates,
          },
          lines,
          totals: {
            fee: fee !== null ? usdText(fee) : null,
            paid: usdText(registration.amountPaid),
            balance: balance !== null && balance > 0.005 ? usdText(balance) : null,
          },
          footnote,
        }),
      }),
    })
  );
}

function formatLongDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
}

/**
 * Sent right after a participant picks "I'll pay later" and chooses a
 * reminder date. Thanks them for registering and confirms the date.
 * Throws (with the reason) if the send fails.
 */
export async function sendPayLaterAcknowledgement(registration: Registration): Promise<void> {
  if (!registration.payLaterDate) return;
  const settings = await getSettingsMap(registration.eventId);
  const first = firstNameOf(registration.fullName);
  const when = formatLongDate(registration.payLaterDate);
  const subject = `Thank you for registering for ${settings.programme_name}`;
  const bodyText = `Hi ${first},\n\nThank you for registering for ${settings.programme_name}.\n\nYou chose to pay later, so we will send you a reminder on ${when}. Your seat is confirmed once payment is received, so please keep that date in mind.\n\nIf you need to change the date or have any questions, reply to this email or reach us on WhatsApp.`;

  throwIfFailed(
    await deliverAttendeeEmail({
      source: "REGISTRATION",
      kind: "pay_later_ack",
      id: registration.id,
      to: registration.email,
      build: async () => ({
        subject,
        html: renderBrandedEmail({
        brand: emailBrand(settings),
          eyebrow: settings.event_caption,
          heading: subject,
          bodyText,
          summaryBlocks: [
            {
              heading: "Your Reminder",
              rows: [
                ["Name", registration.fullName],
                ["Registration Fee", registration.regType === "LATE" ? settings.late_registration_fee : settings.registration_fee],
                ["Reminder date", when],
              ],
            },
          ],
          ctaLabel: "Contact The Team",
          ctaUrl: buildWhatsAppUrl(settings.contact_whatsapp_number, settings.contact_whatsapp_message),
        }),
      }),
    })
  );
}

/**
 * The reminder itself, sent on the date the participant chose. Includes the
 * payment details. Throws (with the reason) if the send fails.
 */
export async function sendPayLaterReminder(registration: Registration): Promise<void> {
  const settings = await getSettingsMap(registration.eventId);
  const first = firstNameOf(registration.fullName);
  const subject = "A gentle reminder about your registration";
  const bodyText = `Dear ${first},\n\nWe hope you are keeping well.\n\nYou asked us to remind you about your payment for ${settings.programme_name}, so here is a gentle note. We would be delighted to have you with us from ${settings.cohort_dates}.\n\nThe button below takes you back to the payment page, where you can choose the currency you prefer and the payment method that suits you. If you have already paid, thank you, and you are welcome to upload your receipt there.\n\nIf you have any questions, simply reply to this email or reach us on WhatsApp. We are always happy to help.\n\nWarm regards,\nThe Investor Hangout Team`;

  throwIfFailed(
    await deliverAttendeeEmail({
      source: "REGISTRATION",
      kind: "pay_later_reminder",
      id: registration.id,
      to: registration.email,
      build: async () => ({
        subject,
        html: renderBrandedEmail({
        brand: emailBrand(settings),
          eyebrow: settings.event_caption,
          heading: subject,
          bodyText,
          ctaLabel: "Complete My Payment",
          ctaUrl: paymentPageLink(registration, settings),
        }),
      }),
    })
  );

  await prisma.registration.update({
    where: { id: registration.id },
    data: { payLaterReminderAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Invitation, reminder and entry ticket (the Attendance flow)
// ---------------------------------------------------------------------------

/** The unique link a guest uses to see their details and reserve their seat; afterwards it shows their ticket. Looks like https://pertinencegroup.com/event/investor-hangout/reserve?t=... */
export function reserveLink(registration: Pick<Registration, "id">, eventSlug: string): string {
  return `${appBaseUrl()}${BASE_PATH}/${eventSlug}/reserve?t=${encodeURIComponent(makeReserveToken(registration.id))}`;
}

/** The event details that must be filled in (Settings) before any invitation goes out. */
export function missingEventDetails(settings: Settings): string[] {
  const missing: string[] = [];
  if (!settings.event_date?.trim()) missing.push("event date");
  if (!settings.event_venue?.trim()) missing.push("venue");
  return missing;
}

async function buildInvitation(
  registration: Registration,
  settings: Settings,
  kind: "invitation" | "reminder",
  linkOverride?: string
): Promise<BuiltEmail> {
  const link = linkOverride ?? reserveLink(registration, settings.event_slug);
  const vars = { ...registrationVars(registration, settings), reserve_link: link };
  const template = await getTemplate(registration.eventId, kind === "reminder" ? "reservation_reminder" : "invitation");
  const subject = mergeTemplate(template.subject, vars);
  const bodyText = mergeTemplate(template.body, vars);

  // Both extras can be switched off for an event (Attendance page): then the email is just the message.
  const showDetails = settings.invite_show_details !== "0";
  const showButton = settings.invite_show_button !== "0";
  const html = renderBrandedEmail({
    brand: emailBrand(settings),
    eyebrow: settings.event_caption || "By invitation only",
    heading: subject,
    bodyText,
    ...(showDetails
      ? {
          summaryBlocks: [
            {
              heading: "The Event",
              rows: [
                ["Event", settings.programme_name],
                ["Date", settings.event_date],
                ["Time", settings.event_time || "To be announced"],
                ["Venue", settings.event_venue],
              ],
            } as SummaryBlock,
          ],
        }
      : {}),
    ...(showButton ? { ctaLabel: "Reserve My Seat", ctaUrl: link } : {}),
  });

  return { subject, html, replyTo: resolveReplyTo(template.replyTo, vars) };
}

/**
 * What the invitation (or reminder) looks like, with the admin as the sample guest. Used to preview it and to send a test before
 * a bulk send. The button in a test points to a link that does nothing. Nothing is recorded and no guest is touched.
 */
export async function previewInvitation(opts: { eventId: string; kind: "invitation" | "reminder"; sampleName: string; sampleEmail: string; settings?: Settings }): Promise<BuiltEmail> {
  const settings = opts.settings ?? (await getSettingsMap(opts.eventId));
  const sample = { id: "preview", eventId: opts.eventId, fullName: opts.sampleName, email: opts.sampleEmail, phone: "", country: "", notes: null, regType: "EARLY" } as unknown as Registration;
  return buildInvitation(sample, settings, opts.kind, `${appBaseUrl()}${BASE_PATH}/${settings.event_slug}/reserve?t=TEST-LINK-NOT-ACTIVE`);
}

/** Sends that preview to one address, marked [TEST]. */
export async function sendInvitationTest(opts: { eventId: string; kind: "invitation" | "reminder"; to: string; sampleName: string }): Promise<SendEmailResult> {
  try {
    const built = await previewInvitation({ eventId: opts.eventId, kind: opts.kind, sampleName: opts.sampleName, sampleEmail: opts.to });
    return await sendEmail({ kind: "invitation", to: opts.to, subject: `[TEST] ${built.subject}`, html: built.html, replyTo: built.replyTo, tags: [{ name: "source", value: "invitation-test" }] });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Emails a guest their unique reserve link. kind "reminder" uses the reminder wording, for people who were
 * invited but have not reserved yet. Throws (with the reason) if the send fails; the outcome is recorded either way.
 */
export async function sendInvitation(registration: Registration, kind: "invitation" | "reminder" = "invitation", knownSettings?: Settings): Promise<void> {
  const settings = knownSettings ?? (await getSettingsMap(registration.eventId));
  throwIfFailed(
    await deliverAttendeeEmail({
      source: "REGISTRATION",
      kind,
      id: registration.id,
      to: registration.email,
      build: () => buildInvitation(registration, settings, kind),
    })
  );

  await prisma.registration.update({
    where: { id: registration.id },
    data: { inviteSentAt: new Date() },
  });
}

/**
 * Emails the entry ticket (designed like a ticket, with a QR code and the ticket code) to a guest who has reserved.
 * Throws if the guest has no ticket yet or the send fails. The seat stays reserved either way.
 */
export async function sendTicket(registration: Registration, knownSettings?: Settings): Promise<void> {
  const code = registration.ticketCode;
  if (!code || !registration.reservedAt) {
    throw new Error("This guest has no ticket yet. They need to reserve a seat first.");
  }
  const settings = knownSettings ?? (await getSettingsMap(registration.eventId));

  throwIfFailed(
    await deliverAttendeeEmail({
      source: "REGISTRATION",
      kind: "ticket",
      id: registration.id,
      to: registration.email,
      build: async () => {
        const subject = `Your ticket: ${settings.programme_name}`;
        const contact = [settings.contact_email?.trim(), settings.contact_phone?.trim()].filter(Boolean).join(" or ");
        const html = renderTicketEmail({
        brand: emailBrand(settings),
          eventName: settings.programme_name,
          guestName: registration.fullName,
          ticketCode: code,
          date: settings.event_date,
          time: settings.event_time,
          venue: settings.event_venue,
          intro: `Hi ${firstNameOf(registration.fullName)},\n\nThank you for confirming. Your seat at the ${settings.programme_name} is reserved, and your entry ticket is below.`,
          contactLine: contact ? `Questions? You can reach us on ${contact}.` : undefined,
          qrCid: "ticket-qr",
        });
        return {
          subject,
          html,
          replyTo: resolveReplyTo("{{contact_email}}", settings),
          attachments: [{ filename: "ticket-qr.png", content: await ticketQrPng(code, settings.event_slug), contentType: "image/png", cid: "ticket-qr" }],
        };
      },
    })
  );

  await prisma.registration.update({
    where: { id: registration.id },
    data: { ticketSentAt: new Date() },
  });
}
