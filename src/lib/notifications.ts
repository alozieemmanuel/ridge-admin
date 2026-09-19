import { prisma } from "@/lib/prisma";
import { getSettingsMap, mergeTemplate, buildWhatsAppUrl } from "@/lib/settings";
import { renderBrandedEmail, sendEmail } from "@/lib/email";
import type { Registration, BrochureRequest } from "@prisma/client";

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

async function recordEvent(params: {
  source: "REGISTRATION" | "BROCHURE";
  audience: "ATTENDEE" | "INTERNAL";
  registrationId?: string;
  brochureRequestId?: string;
  type: "SENT" | "FAILED";
  providerMessageId?: string;
}) {
  await prisma.emailEvent.create({
    data: {
      source: params.source,
      audience: params.audience,
      registrationId: params.registrationId,
      brochureRequestId: params.brochureRequestId,
      type: params.type,
      providerMessageId: params.providerMessageId,
    },
  });
}

/** Sends the attendee confirmation + internal team notification for a new registration. */
export async function sendRegistrationEmails(registration: Registration): Promise<void> {
  const settings = await getSettingsMap();
  const vars: Record<string, string> = {
    first_name: firstNameOf(registration.fullName),
    full_name: registration.fullName,
    email: registration.email,
    phone: registration.phone,
    country: registration.country,
    organization: registration.organization || "-",
    notes: registration.notes || "-",
    reg_type_label: registration.regType === "LATE" ? "Late Registration" : "Early Bird",
    fee_label: registration.regType === "LATE" ? settings.late_registration_fee : settings.registration_fee,
    ...settings,
  };

  const template = await getTemplate("registration_confirmation");
  const subject = mergeTemplate(template.subject, vars);
  const bodyText = mergeTemplate(template.body, vars);
  const whatsappUrl = buildWhatsAppUrl(settings.contact_whatsapp_number, settings.contact_whatsapp_message);

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
      {
        heading: "Payment / Account Details",
        rows: [
          ["Account Name", settings.payment_account_name],
          ["Bank", settings.payment_bank_name],
          ["Account Number", settings.payment_account_number],
          ["Currency", settings.currency],
        ],
      },
    ],
    ctaLabel: "Contact The RIDGE Team",
    ctaUrl: whatsappUrl,
  });

  const result = await sendEmail({
    to: registration.email,
    subject,
    html,
    replyTo: template.replyTo,
    tags: [
      { name: "source", value: "registration" },
      { name: "id", value: registration.id },
    ],
  });

  await recordEvent({
    source: "REGISTRATION",
    audience: "ATTENDEE",
    registrationId: registration.id,
    type: result.success ? "SENT" : "FAILED",
    providerMessageId: result.providerMessageId,
  });

  if (settings.notification_email) {
    const internalTemplate = await getTemplate("internal_registration_notification");
    const internalSubject = mergeTemplate(internalTemplate.subject, vars);
    const internalBody = mergeTemplate(internalTemplate.body, vars);
    const internalResult = await sendEmail({
      to: settings.notification_email,
      subject: internalSubject,
      html: `<pre style="font-family:monospace;white-space:pre-wrap;">${internalBody
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</pre>`,
    });
    await recordEvent({
      source: "REGISTRATION",
      audience: "INTERNAL",
      registrationId: registration.id,
      type: internalResult.success ? "SENT" : "FAILED",
      providerMessageId: internalResult.providerMessageId,
    });
  }
}

/** Sends the brochure email + internal team notification for a new brochure request. */
export async function sendBrochureEmails(brochureRequest: BrochureRequest): Promise<void> {
  const settings = await getSettingsMap();
  const vars: Record<string, string> = {
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

  const result = await sendEmail({
    to: brochureRequest.email,
    subject,
    html,
    replyTo: template.replyTo,
    tags: [
      { name: "source", value: "brochure" },
      { name: "id", value: brochureRequest.id },
    ],
  });

  await recordEvent({
    source: "BROCHURE",
    audience: "ATTENDEE",
    brochureRequestId: brochureRequest.id,
    type: result.success ? "SENT" : "FAILED",
    providerMessageId: result.providerMessageId,
  });

  if (settings.notification_email) {
    const internalTemplate = await getTemplate("internal_brochure_notification");
    const internalSubject = mergeTemplate(internalTemplate.subject, vars);
    const internalBody = mergeTemplate(internalTemplate.body, vars);
    const internalResult = await sendEmail({
      to: settings.notification_email,
      subject: internalSubject,
      html: `<pre style="font-family:monospace;white-space:pre-wrap;">${internalBody
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</pre>`,
    });
    await recordEvent({
      source: "BROCHURE",
      audience: "INTERNAL",
      brochureRequestId: brochureRequest.id,
      type: internalResult.success ? "SENT" : "FAILED",
      providerMessageId: internalResult.providerMessageId,
    });
  }
}
