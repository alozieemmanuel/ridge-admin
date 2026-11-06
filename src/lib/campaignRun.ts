import type { CampaignAudience, Event, Registration } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audienceWhere } from "@/lib/campaigns";
import { getSettingsMap } from "@/lib/settings";
import { buildMailchimpCampaignEmail, reserveLink } from "@/lib/notifications";
import { queueCampaignEmails, drainEmailQueue } from "@/lib/emailQueue";
import { mailchimpConfigured, sendMailchimpCampaign, withMailchimpFooter, type MailchimpGuest } from "@/lib/mailchimp";
import type { SendProgress } from "@/lib/sendProgress";

/**
 * The two ways a campaign is sent, as plain functions. The Campaigns page calls them through the send routes,
 * and the scheduler calls them at the chosen time, so a scheduled campaign goes out exactly like one sent by hand.
 */

export interface CampaignInput {
  audience: CampaignAudience;
  category: string | null;
  subject: string;
  body: string;
  ctaLabel: string | null;
}

/** A problem the sender should be told about, with the HTTP status the route answers with. */
export class CampaignSendError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

export interface SendSummary {
  result: "success";
  campaign: { id: string; recipientCount: number; sentCount: number; failedCount: number; waitingCount: number };
  skipped: { alreadyGot: number; alreadyWaiting: number };
  blocked: unknown;
  markedInvited?: number;
  unsubscribed?: number;
  refused?: number;
  reasons?: { reason: string; count: number }[];
}

async function recipientsFor(event: Event, input: CampaignInput) {
  const recipients: Registration[] = await prisma.registration.findMany({ where: { AND: [{ eventId: event.id }, { email: { not: "" } }, audienceWhere(input.audience, input.category)] } });
  if (recipients.length === 0) throw new CampaignSendError("No registrations match that audience.");
  return recipients;
}

/** The same email (event, subject, message, button) is never sent to the same person twice. */
async function leaveOutAlreadySent(event: Event, input: CampaignInput, recipients: Registration[], countWaiting: boolean) {
  const siblings = await prisma.campaign.findMany({ where: { eventId: event.id, subject: input.subject, body: input.body, ctaLabel: input.ctaLabel }, select: { id: true } });
  const siblingIds = siblings.map((c: { id: string }) => c.id);
  let alreadyGot = 0;
  let alreadyWaiting = 0;
  let toSend = recipients;
  if (siblingIds.length) {
    const ids = recipients.map((r) => r.id);
    const [got, waiting] = await Promise.all([
      prisma.emailEvent.findMany({ where: { type: "SENT", campaignId: { in: siblingIds }, registrationId: { in: ids } }, select: { registrationId: true }, distinct: ["registrationId"] }),
      countWaiting
        ? prisma.queuedEmail.findMany({ where: { status: { in: ["PENDING", "SENDING"] }, campaignId: { in: siblingIds }, registrationId: { in: ids } }, select: { registrationId: true }, distinct: ["registrationId"] })
        : Promise.resolve([] as { registrationId: string | null }[]),
    ]);
    const gotSet = new Set(got.map((g: { registrationId: string | null }) => g.registrationId));
    const waitSet = new Set(waiting.map((w: { registrationId: string | null }) => w.registrationId));
    alreadyGot = gotSet.size;
    alreadyWaiting = [...waitSet].filter((id) => !gotSet.has(id)).length;
    toSend = recipients.filter((r) => !gotSet.has(r.id) && !waitSet.has(r.id));
  }
  if (toSend.length === 0) {
    const msg = countWaiting
      ? `Everyone in that audience already has this email (${alreadyGot}) or is already waiting for it (${alreadyWaiting}). Nothing was sent. Use "Send waiting emails now" to finish the ones that are waiting, or change the subject to send a new email.`
      : `Everyone in that audience already has this email (${alreadyGot}). Nothing was sent. Change the subject to send a new email.`;
    throw new CampaignSendError(msg, 409, "ALREADY_SENT");
  }
  return { toSend, alreadyGot, alreadyWaiting };
}

/** Normal send (Gmail / Brevo senders through the queue). */
export async function sendNormalCampaign(event: Event, senderName: string, input: CampaignInput): Promise<SendSummary> {
  const recipients = await recipientsFor(event, input);
  const { toSend, alreadyGot, alreadyWaiting } = await leaveOutAlreadySent(event, input, recipients, true);
  const campaign = await prisma.campaign.create({
    data: { eventId: event.id, subject: input.subject, body: input.body, audience: input.audience, category: input.category, recipientCount: toSend.length, sentCount: 0, failedCount: 0, sentByName: senderName, ctaLabel: input.ctaLabel },
  });
  await queueCampaignEmails(campaign.id, toSend.map((r) => r.id));
  const run = await drainEmailQueue({ campaignId: campaign.id, budgetMs: 40_000 });
  const fresh = await prisma.campaign.findUnique({ where: { id: campaign.id }, select: { sentCount: true, failedCount: true } });
  return {
    result: "success",
    campaign: { id: campaign.id, recipientCount: toSend.length, sentCount: fresh?.sentCount ?? run.sent, failedCount: fresh?.failedCount ?? run.failed, waitingCount: run.waiting },
    skipped: { alreadyGot, alreadyWaiting },
    blocked: run.blocked,
  };
}

export interface PreparedMailchimp {
  event: Event;
  input: CampaignInput;
  campaignId: string;
  guests: (MailchimpGuest & { reg: Registration })[];
  name: string;
  subject: string;
  html: string;
  alreadyGot: number;
}

/** Everything that can be checked before sending. Throws CampaignSendError, so a route can answer before it starts streaming. */
export async function prepareMailchimpCampaign(event: Event, senderName: string, input: CampaignInput): Promise<PreparedMailchimp> {
  if (!mailchimpConfigured()) throw new CampaignSendError("Mailchimp is not set up on the server. Add MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID and MAILCHIMP_FROM.");
  const recipients = await recipientsFor(event, input);
  const { toSend, alreadyGot } = await leaveOutAlreadySent(event, input, recipients, false);

  const settings = await getSettingsMap(event.id);
  const built = buildMailchimpCampaignEmail(settings, input.subject, input.body, input.ctaLabel ?? undefined);
  const html = withMailchimpFooter(built.html, settings.event_name || event.name);

  // One row per address (Mailchimp has one member per email).
  const seen = new Set<string>();
  const guests: (MailchimpGuest & { reg: Registration })[] = [];
  for (const r of toSend) {
    const email = r.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const parts = r.fullName.trim().split(/\s+/);
    guests.push({ id: r.id, email, firstName: parts[0] || "there", lastName: parts.slice(1).join(" "), link: reserveLink(r, settings.event_slug), reg: r });
  }

  const campaign = await prisma.campaign.create({
    data: { eventId: event.id, subject: input.subject, body: input.body, audience: input.audience, category: input.category, recipientCount: guests.length, sentCount: 0, failedCount: 0, sentByName: senderName, ctaLabel: input.ctaLabel },
  });
  return { event, input, campaignId: campaign.id, guests, name: settings.event_name || event.name, subject: built.subject, html, alreadyGot };
}

/** Sends a prepared Mailchimp campaign and records the results. Removes the campaign row when nothing could be sent. */
export async function executeMailchimpCampaign(p: PreparedMailchimp, onProgress?: (x: SendProgress) => void): Promise<SendSummary> {
  const { event, input, campaignId, guests } = p;
  try {
    const res = await sendMailchimpCampaign({ name: p.name, subject: p.subject, html: p.html, guests, onProgress });
    onProgress?.({ stage: "saving", message: "Saving the results…" });
    const subject = input.subject.slice(0, 300);
    const rows = [
      ...res.sent.map((g) => ({ source: "CAMPAIGN" as const, type: "SENT" as const, registrationId: g.id, campaignId, kind: "campaign", provider: "MAILCHIMP" as const, subject, providerMessageId: res.mailchimpCampaignId })),
      ...res.left.map((l) => ({ source: "CAMPAIGN" as const, type: "FAILED" as const, registrationId: l.guest.id, campaignId, kind: "campaign", provider: "MAILCHIMP" as const, subject, errorMessage: l.reason })),
    ];
    for (let i = 0; i < rows.length; i += 500) await prisma.emailEvent.createMany({ data: rows.slice(i, i + 500) });
    await prisma.campaign.update({ where: { id: campaignId }, data: { sentCount: res.sent.length, failedCount: res.left.length } });
    // An email that carries the guest's own reserve link is an invitation: the guests it reached count as invited.
    let markedInvited = 0;
    if (input.ctaLabel || /\{\{\s*reserve_link\s*\}\}/.test(input.body)) {
      const marked = await prisma.registration.updateMany({ where: { eventId: event.id, id: { in: res.sent.map((g) => g.id) }, inviteSentAt: null, reservedAt: null }, data: { inviteSentAt: new Date() } });
      markedInvited = marked.count;
    }
    return {
      result: "success",
      campaign: { id: campaignId, recipientCount: guests.length, sentCount: res.sent.length, failedCount: res.left.length, waitingCount: 0 },
      skipped: { alreadyGot: p.alreadyGot, alreadyWaiting: 0 },
      blocked: null,
      markedInvited,
      unsubscribed: res.unsubscribed,
      refused: res.refused,
      reasons: res.reasons.slice(0, 3),
    };
  } catch (err) {
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {});
    throw err;
  }
}

/** One plain sentence about what a finished send did, kept with a scheduled campaign. */
export function summarize(s: SendSummary): string {
  const c = s.campaign;
  const parts = [`Sent to ${c.sentCount} of ${c.recipientCount}`];
  if (c.failedCount) parts.push(`${c.failedCount} not sent`);
  if (c.waitingCount) parts.push(`${c.waitingCount} waiting for the next send window`);
  if (s.unsubscribed) parts.push(`${s.unsubscribed} unsubscribed in Mailchimp, skipped`);
  if (s.reasons?.length) parts.push(`${s.reasons[0].count} x ${s.reasons[0].reason}`);
  return parts.join(". ") + ".";
}
