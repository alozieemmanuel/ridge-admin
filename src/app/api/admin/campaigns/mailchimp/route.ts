import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendCampaignSchema } from "@/lib/validation";
import { audienceWhere } from "@/lib/campaigns";
import { requireEvent } from "@/lib/event";
import { getSettingsMap } from "@/lib/settings";
import { buildMailchimpCampaignEmail, reserveLink } from "@/lib/notifications";
import { mailchimpConfigured, sendMailchimpCampaign, withMailchimpFooter, type MailchimpGuest } from "@/lib/mailchimp";
import type { Registration } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Sends a broadcast through Mailchimp's own campaigns. The guests are added to the Mailchimp audience and Mailchimp sends
 * one campaign to them. Mailchimp leaves out anyone who has unsubscribed there. People who already got the same email from
 * this dashboard are left out, like on the normal send.
 */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "campaigns" });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;

  if (!mailchimpConfigured()) {
    return NextResponse.json({ error: "Mailchimp is not set up on the server. Add MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID and MAILCHIMP_FROM." }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = sendCampaignSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payload." }, { status: 400 });
  const { audience, subject, body, ctaLabel } = parsed.data;
  const category = parsed.data.category || null;
  const ctaValue = ctaLabel ?? null;

  const recipients = await prisma.registration.findMany({ where: { AND: [{ eventId: event.id }, { email: { not: "" } }, audienceWhere(audience, category)] } });
  if (recipients.length === 0) return NextResponse.json({ error: "No registrations match that audience." }, { status: 400 });

  const siblings = await prisma.campaign.findMany({ where: { eventId: event.id, subject, body, ctaLabel: ctaValue }, select: { id: true } });
  let toSend: Registration[] = recipients;
  let alreadyGot = 0;
  if (siblings.length) {
    const got = await prisma.emailEvent.findMany({
      where: { type: "SENT", campaignId: { in: siblings.map((s) => s.id) }, registrationId: { in: recipients.map((r: Registration) => r.id) } },
      select: { registrationId: true },
      distinct: ["registrationId"],
    });
    const gotSet = new Set(got.map((g) => g.registrationId));
    alreadyGot = gotSet.size;
    toSend = recipients.filter((r: Registration) => !gotSet.has(r.id));
  }
  if (toSend.length === 0) {
    return NextResponse.json({ error: `Everyone in that audience already has this email (${alreadyGot}). Nothing was sent. Change the subject to send a new email.`, code: "ALREADY_SENT" }, { status: 409 });
  }

  const settings = await getSettingsMap(event.id);
  const built = buildMailchimpCampaignEmail(settings, subject, body, ctaLabel);
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
    data: { eventId: event.id, subject, body, audience, category, recipientCount: guests.length, sentCount: 0, failedCount: 0, sentByName: session.name, ctaLabel: ctaValue },
  });

  try {
    const res = await sendMailchimpCampaign({ name: settings.event_name || event.name, subject: built.subject, html, guests });
    const rows = [
      ...res.sent.map((g) => ({ source: "CAMPAIGN" as const, type: "SENT" as const, registrationId: g.id, campaignId: campaign.id, kind: "campaign", provider: "MAILCHIMP" as const, subject: subject.slice(0, 300), providerMessageId: res.mailchimpCampaignId })),
      ...res.left.map((l) => ({ source: "CAMPAIGN" as const, type: "FAILED" as const, registrationId: l.guest.id, campaignId: campaign.id, kind: "campaign", provider: "MAILCHIMP" as const, subject: subject.slice(0, 300), errorMessage: l.reason })),
    ];
    for (let i = 0; i < rows.length; i += 500) await prisma.emailEvent.createMany({ data: rows.slice(i, i + 500) });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { sentCount: res.sent.length, failedCount: res.left.length } });
    return NextResponse.json({
      result: "success",
      campaign: { id: campaign.id, recipientCount: guests.length, sentCount: res.sent.length, failedCount: res.left.length, waitingCount: 0 },
      skipped: { alreadyGot, alreadyWaiting: 0 },
      blocked: null,
    });
  } catch (err) {
    // Nothing was sent, so the campaign row is removed and the same send can be tried again.
    await prisma.campaign.delete({ where: { id: campaign.id } }).catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
