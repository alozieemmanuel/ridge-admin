import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendCampaignSchema } from "@/lib/validation";
import { audienceWhere } from "@/lib/campaigns";
import { requireEvent } from "@/lib/event";
import { getSettingsMap } from "@/lib/settings";
import { buildMailchimpCampaignEmail, reserveLink } from "@/lib/notifications";
import { mailchimpConfigured, sendMailchimpCampaign, withMailchimpFooter, type MailchimpGuest } from "@/lib/mailchimp";
import type { SendEvent, SendProgress } from "@/lib/sendProgress";
import type { Registration } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  // The answer is streamed, one JSON object per line: progress while it works, then "done" or "error".
  // This lets the Campaigns page show what is happening instead of a spinner that never ends.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (e: SendEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          // The page was closed. The send carries on on the server.
        }
      };
      const progress = (p: SendProgress) => write({ type: "progress", progress: p });
      try {
        const res = await sendMailchimpCampaign({ name: settings.event_name || event.name, subject: built.subject, html, guests, onProgress: progress });
        progress({ stage: "saving", message: "Saving the results…" });
        const rows = [
          ...res.sent.map((g) => ({ source: "CAMPAIGN" as const, type: "SENT" as const, registrationId: g.id, campaignId: campaign.id, kind: "campaign", provider: "MAILCHIMP" as const, subject: subject.slice(0, 300), providerMessageId: res.mailchimpCampaignId })),
          ...res.left.map((l) => ({ source: "CAMPAIGN" as const, type: "FAILED" as const, registrationId: l.guest.id, campaignId: campaign.id, kind: "campaign", provider: "MAILCHIMP" as const, subject: subject.slice(0, 300), errorMessage: l.reason })),
        ];
        for (let i = 0; i < rows.length; i += 500) await prisma.emailEvent.createMany({ data: rows.slice(i, i + 500) });
        await prisma.campaign.update({ where: { id: campaign.id }, data: { sentCount: res.sent.length, failedCount: res.left.length } });
        // An email that carries the guest's own reserve link is an invitation: the guests it reached count as invited,
        // so "Not invited yet" and "Invited, not reserved" on the Attendance page stay right. Earlier invite dates are kept.
        let markedInvited = 0;
        if (ctaLabel || /\{\{\s*reserve_link\s*\}\}/.test(body)) {
          const marked = await prisma.registration.updateMany({
            where: { eventId: event.id, id: { in: res.sent.map((g) => g.id) }, inviteSentAt: null, reservedAt: null },
            data: { inviteSentAt: new Date() },
          });
          markedInvited = marked.count;
        }
        write({
          type: "done",
          result: {
            result: "success",
            campaign: { id: campaign.id, recipientCount: guests.length, sentCount: res.sent.length, failedCount: res.left.length, waitingCount: 0 },
            skipped: { alreadyGot, alreadyWaiting: 0 },
            blocked: null,
            markedInvited,
            unsubscribed: res.unsubscribed,
            refused: res.refused,
            reasons: res.reasons.slice(0, 3),
          },
        });
      } catch (err) {
        // Nothing was sent, so the campaign row is removed and the same send can be tried again.
        await prisma.campaign.delete({ where: { id: campaign.id } }).catch(() => {});
        write({ type: "error", error: err instanceof Error ? err.message : String(err) });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
