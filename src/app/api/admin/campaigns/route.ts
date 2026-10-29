import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendCampaignSchema } from "@/lib/validation";
import { audienceWhere } from "@/lib/campaigns";
import { requireEvent } from "@/lib/event";
import { queueCampaignEmails, drainEmailQueue } from "@/lib/emailQueue";
import type { Campaign, Registration } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 60;

type StatKey = "delivered" | "opened" | "bounced" | "complained";
type StatCounts = Record<StatKey, number>;

const emptyCounts = (): StatCounts => ({ delivered: 0, opened: 0, bounced: 0, complained: 0 });

/**
 * Returns campaigns with per-campaign delivery/open/bounce counts, plus overall
 * totals for the stats strip. Counts are per recipient: someone who opens the
 * same email five times counts as one open. These numbers come from Brevo's
 * webhook, which only exists for campaigns (everything else is sent via Gmail).
 */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "campaigns" });
  if (!ctx.ok) return ctx.response;
  const { event } = ctx;
  const campaigns = await prisma.campaign.findMany({ where: { eventId: event.id }, orderBy: { sentAt: "desc" }, take: 50 });
  const campaignIds = campaigns.map((c: Campaign) => c.id);

  const perCampaign: Record<string, StatCounts> = {};
  const totals = emptyCounts();
  const waitingRows = campaignIds.length ? await prisma.queuedEmail.groupBy({ by: ["campaignId"], where: { campaignId: { in: campaignIds }, status: { in: ["PENDING", "SENDING"] } }, _count: { _all: true } }) : [];
  const waiting: Record<string, number> = Object.fromEntries(waitingRows.map((w) => [w.campaignId, w._count._all]));

  if (campaignIds.length > 0) {
    // One row per (campaign, event type, recipient), so repeat opens collapse to one.
    const grouped = await prisma.emailEvent.groupBy({
      by: ["campaignId", "type", "registrationId"],
      where: {
        source: "CAMPAIGN",
        campaignId: { in: campaignIds },
        type: { in: ["DELIVERED", "OPENED", "BOUNCED", "COMPLAINED"] },
      },
    });

    for (const g of grouped) {
      if (!g.campaignId) continue;
      const key = g.type.toLowerCase() as StatKey;
      perCampaign[g.campaignId] ??= emptyCounts();
      perCampaign[g.campaignId][key] += 1;
      totals[key] += 1;
    }
  }

  return NextResponse.json({
    campaigns: campaigns.map((c: Campaign) => {
      const counts = perCampaign[c.id] ?? emptyCounts();
      return {
        id: c.id,
        subject: c.subject,
        audience: c.audience,
        category: c.category,
        recipientCount: c.recipientCount,
        sentCount: c.sentCount,
        failedCount: c.failedCount,
        waitingCount: waiting[c.id] ?? 0,
        sentAt: c.sentAt.toISOString(),
        sentByName: c.sentByName,
        delivered: counts.delivered,
        opened: counts.opened,
        bounced: counts.bounced,
        complained: counts.complained,
      };
    }),
    stats: totals,
  });
}

/**
 * Sends a one-off broadcast (subject + plain-text body) to every registration
 * matching the chosen audience segment. Sends are batched with a small
 * concurrency limit rather than all at once, since a large audience (500+)
 * could otherwise trip Brevo's rate limit. Each recipient's outcome is
 * recorded as its own EmailEvent (source: CAMPAIGN, tagged with campaignId),
 * and a Campaign row summarizes the whole run for the history list.
 *
 * The Campaign row is created BEFORE sending so every email can carry its
 * campaign ID. That ID is what lets the webhook attribute delivered/opened/
 * bounced events to the right campaign later.
 */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "campaigns" });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = sendCampaignSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid payload." },
      { status: 400 }
    );
  }

  const { audience, subject, body, ctaLabel } = parsed.data;
  const category = parsed.data.category || null;

  const recipients = await prisma.registration.findMany({ where: { AND: [{ eventId: event.id }, { email: { not: "" } }, audienceWhere(audience, category)] } });
  if (recipients.length === 0) {
    return NextResponse.json({ error: "No registrations match that audience." }, { status: 400 });
  }

  // The same email (event, subject, message, button) is never sent to the same person twice. People who already got it, or who are
  // already waiting for it in the queue, are left out, so sending again after a cut-off only does the part that is left.
  const ctaValue = ctaLabel ?? null;
  const siblings = await prisma.campaign.findMany({ where: { eventId: event.id, subject, body, ctaLabel: ctaValue }, select: { id: true } });
  const siblingIds = siblings.map((c) => c.id);
  let alreadyGot = 0;
  let alreadyWaiting = 0;
  let toSend = recipients;
  if (siblingIds.length) {
    const ids = recipients.map((r: Registration) => r.id);
    const [got, waiting] = await Promise.all([
      prisma.emailEvent.findMany({ where: { type: "SENT", campaignId: { in: siblingIds }, registrationId: { in: ids } }, select: { registrationId: true }, distinct: ["registrationId"] }),
      prisma.queuedEmail.findMany({ where: { status: { in: ["PENDING", "SENDING"] }, campaignId: { in: siblingIds }, registrationId: { in: ids } }, select: { registrationId: true }, distinct: ["registrationId"] }),
    ]);
    const gotSet = new Set(got.map((g) => g.registrationId));
    const waitSet = new Set(waiting.map((w) => w.registrationId));
    alreadyGot = gotSet.size;
    alreadyWaiting = [...waitSet].filter((id) => !gotSet.has(id as string)).length;
    toSend = recipients.filter((r: Registration) => !gotSet.has(r.id) && !waitSet.has(r.id));
  }
  if (toSend.length === 0) {
    return NextResponse.json(
      {
        error: `Everyone in that audience already has this email (${alreadyGot}) or is already waiting for it (${alreadyWaiting}). Nothing was sent. Use "Send waiting emails now" to finish the ones that are waiting, or change the subject to send a new email.`,
        code: "ALREADY_SENT",
      },
      { status: 409 }
    );
  }

  const campaign = await prisma.campaign.create({
    data: {
      eventId: event.id,
      subject,
      body,
      audience,
      category,
      recipientCount: toSend.length,
      sentCount: 0,
      failedCount: 0,
      sentByName: session.name,
      ctaLabel: ctaValue,
    },
  });

  // Every recipient is written to the queue first, then sent in short runs that the page keeps asking for. A run that is cut off
  // loses nothing: the rest is still in the queue.
  await queueCampaignEmails(campaign.id, toSend.map((r: Registration) => r.id));
  const run = await drainEmailQueue({ campaignId: campaign.id, budgetMs: 40_000 });
  const fresh = await prisma.campaign.findUnique({ where: { id: campaign.id }, select: { sentCount: true, failedCount: true } });

  return NextResponse.json({
    result: "success",
    campaign: { id: campaign.id, recipientCount: toSend.length, sentCount: fresh?.sentCount ?? run.sent, failedCount: fresh?.failedCount ?? run.failed, waitingCount: run.waiting },
    skipped: { alreadyGot, alreadyWaiting },
    blocked: run.blocked,
  });
}
