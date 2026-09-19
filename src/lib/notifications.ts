import { prisma } from "@/lib/prisma";
import { getSettingsMap, mergeTemplate, buildWhatsAppUrl } from "@/lib/settings";
import { renderBrandedEmail, sendEmail, escapeHtml, isValidEmailAddress } from "@/lib/email";
import type { SendEmailResult, EmailKind } from "@/lib/email";
import type { Registration, BrochureRequest } from "@prisma/client";

type Settings = Record<string, string>;
type EventSource = "REGISTRATION" | "BROCHURE" | "CAMPAIGN";

interface BuiltEmail {
  subject: string;
  html: string;
  replyTo?: string;
}

function firstNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "there";
}

async function getTemplate(key: string) {
  const template = await prisma.emailTemplate.findUnique({ where: { key } });
  if (!template) {
    throw new Error(
      `Email template "${key}" is missing. Run the seed script (npm run seed) to create default templates.`
    );
  }
  return template;
}

/**
 * A template's Reply-To can contain {{tokens}} (the seeded default is
 * {{contact_email}}). Those must be merged BEFORE sending — Resend rejects a
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
 * `kind` picks the channel: "campaign" goes through Resend, everything else
 * goes through Gmail (see sendEmail in email.ts).
 */
async function deliverAttendeeEmail(opts: {
  source: EventSource;
  kind: EmailKind;
  id: string;
  to: string;
  campaignId?: string;
  build: () => Promise<BuiltEmail>;
}): Promise<SendEmailResult> {
  let result: SendEmailResult;
  try {
    const email = await opts.build();
    result = await sendEmail({
      kind: opts.kind,
      to: opts.to,
      subject: email.subject,
      html: email.html,
      replyTo: email.replyTo,
      tags: [
        { name: "source", value: opts.source === "BROCHURE" ? "brochure" : opts.source === "CAMPAIGN" ? "campaign" : "registration" },
        { name: "id", value: opts.id },
        ...(opts.campaignId ? [{ name: "campaign", value: opts.campaignId }] : []),
      ],
    });
  } catch (err) {
    result = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  await recordEvent({
    source: opts.source,
    audience: "ATTENDEE",
    id: opts.id,
    type: result.success ? "SENT" : "FAILED",
    kind: opts.kind,
    providerMessageId: result.providerMessageId,
    errorMessage: result.error,
    campaignId: opts.campaignId,
  });
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
    organization: registration.organization || "-",
    notes: registration.notes || "-",
    reg_type_label: registration.regType === "LATE" ? "Late Registration" : "Early Bird",
    fee_label: registration.regType === "LATE" ? settings.late_registration_fee : settings.registration_fee,
    registration_id: registration.id,
    ...settings,
  };
}

const PAYMENT_DETAILS_BLOCK = (settings: Settings) => ({
  heading: "Payment / Account Details",
  rows: [
    ["Account Name", settings.payment_account_name],
    ["Bank", settings.payment_bank_name],
    ["Account Number", settings.payment_account_number],
    ["Currency", settings.currency],
  ] as [string, string][],
});

async function buildRegistrationConfirmation(registration: Registration, settings: Settings): Promise<BuiltEmail> {
  const vars = registrationVars(registration, settings);
  const template = await getTemplate("registration_confirmation");
  const subject = mergeTemplate(template.subject, vars);
  const bodyText = mergeTemplate(template.body, vars);

  const html = renderBrandedEmail({
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
      PAYMENT_DETAILS_BLOCK(settings),
    ],
    ctaLabel: "Contact The RIDGE Team",
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
  const template = await getTemplate("brochure_confirmation");
  const subject = mergeTemplate(template.subject, vars);
  const bodyText = mergeTemplate(template.body, vars);

  const html = renderBrandedEmail({
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

async function buildSeatInvite(registration: Registration, settings: Settings): Promise<BuiltEmail> {
  const vars = registrationVars(registration, settings);
  const template = await getTemplate("seat_selection_invite");
  const subject = mergeTemplate(template.subject, vars);
  const bodyText = mergeTemplate(template.body, vars);

  const html = renderBrandedEmail({
    eyebrow: settings.event_caption,
    heading: subject,
    bodyText,
    ctaLabel: "Choose Your Seat",
    ctaUrl: `${settings.seat_selection_url}?rid=${registration.id}`,
  });

  return { subject, html, replyTo: resolveReplyTo(template.replyTo, vars) };
}

async function buildPaymentReminder(registration: Registration, settings: Settings): Promise<BuiltEmail> {
  const vars = registrationVars(registration, settings);
  const template = await getTemplate("payment_reminder");
  const subject = mergeTemplate(template.subject, vars);
  const bodyText = mergeTemplate(template.body, vars);

  const html = renderBrandedEmail({
    eyebrow: settings.event_caption,
    heading: subject,
    bodyText,
    summaryBlocks: [PAYMENT_DETAILS_BLOCK(settings)],
  });

  return { subject, html, replyTo: resolveReplyTo(template.replyTo, vars) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** New registration: attendee confirmation + internal team alert. Never throws for a failed send — the outcome is recorded. */
export async function sendRegistrationEmails(registration: Registration): Promise<void> {
  const settings = await getSettingsMap();

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
    subject: `New RIDGE registration: ${registration.fullName}`,
    replyTo: registration.email,
    rows: [
      ["Name", registration.fullName],
      ["Email", registration.email],
      ["Phone", registration.phone],
      ["Country", registration.country],
      ["Organization", registration.organization],
      ["Registration type", registration.regType === "LATE" ? "Late Registration" : "Early Bird"],
      ["Notes", registration.notes],
    ],
  });
}

/** New brochure request: brochure email + internal team alert. Never throws for a failed send — the outcome is recorded. */
export async function sendBrochureEmails(brochureRequest: BrochureRequest): Promise<void> {
  const settings = await getSettingsMap();

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
    subject: `New RIDGE brochure request: ${brochureRequest.fullName}`,
    replyTo: brochureRequest.email,
    rows: [
      ["Name", brochureRequest.fullName],
      ["Email", brochureRequest.email],
    ],
  });
}

/** Admin action: re-send just the attendee confirmation. Throws (with the reason) if it fails. */
export async function resendRegistrationConfirmation(registration: Registration): Promise<void> {
  const settings = await getSettingsMap();
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
  const settings = await getSettingsMap();
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

/** Admin action: the "pick your seat" invite, sent once payment is confirmed. */
export async function sendSeatSelectionInvite(registration: Registration): Promise<void> {
  const settings = await getSettingsMap();
  throwIfFailed(
    await deliverAttendeeEmail({
      source: "REGISTRATION",
      kind: "seat_invite",
      id: registration.id,
      to: registration.email,
      build: () => buildSeatInvite(registration, settings),
    })
  );

  await prisma.registration.update({
    where: { id: registration.id },
    data: { seatInviteSentAt: new Date() },
  });
}

/** Admin action: a payment reminder for anyone not fully paid. */
export async function sendPaymentReminder(registration: Registration): Promise<void> {
  const settings = await getSettingsMap();
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
 * This is the only path that uses Resend (kind: "campaign").
 */
export async function sendCampaignEmail(
  registration: Registration,
  subject: string,
  bodyText: string,
  settings: Settings,
  campaignId?: string
): Promise<SendEmailResult> {
  const vars = registrationVars(registration, settings);
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
        eyebrow: settings.event_caption,
        heading: mergedSubject,
        bodyText: mergedBody,
      }),
    }),
  });
}