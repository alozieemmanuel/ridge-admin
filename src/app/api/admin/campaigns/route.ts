import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendCampaignSchema } from "@/lib/validation";
import { audienceWhere } from "@/lib/campaigns";
import { getSettingsMap } from "@/lib/settings";
import { sendCampaignEmail } from "@/lib/notifications";
import { requireEvent } from "@/lib/event";
import { queueCampaignEmails } from "@/lib/emailQueue";
import type { Campaign, Registration } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  const waitingRows = campaignIds.length ? await prisma.queuedEmail.groupBy({ by: ["campaignId"], where: { campaignId: { in: campaignIds }, status: "PENDING" }, _count: { _all: true } }) : [];
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

  const settings = await getSettingsMap(event.id);

  const campaign = await prisma.campaign.create({
    data: {
      eventId: event.id,
      subject,
      body,
      audience,
      category,
      recipientCount: recipients.length,
      sentCount: 0,
      failedCount: 0,
      sentByName: session.name,
      ctaLabel: ctaLabel ?? null,
    },
  });

  let sentCount = 0;
  let failedCount = 0;
  const deferredIds: string[] = [];

  try {
    const CONCURRENCY = 5;
    for (let i = 0; i < recipients.length; i += CONCURRENCY) {
      const batch = recipients.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((r: Registration) => sendCampaignEmail(r, subject, body, settings, campaign.id, ctaLabel))
      );
      results.forEach((r, index) => {
        if (r.deferred) deferredIds.push(batch[index].id);
        else if (r.success) sentCount++;
        else failedCount++;
      });
      // Every sender has used its daily limit: the rest waits for tomorrow instead of failing.
      if (deferredIds.length) {
        deferredIds.push(...recipients.slice(i + CONCURRENCY).map((x: Registration) => x.id));
        break;
      }
    }
  } finally {
    // Always record what happened, even if something threw partway through
    // (for example, the function hit its time limit on a very large audience).
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { sentCount, failedCount },
    });
    await queueCampaignEmails(campaign.id, deferredIds);
  }

  return NextResponse.json({
    result: "success",
    campaign: { id: campaign.id, recipientCount: recipients.length, sentCount, failedCount, waitingCount: deferredIds.length },
  });
}