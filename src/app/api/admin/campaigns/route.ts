import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendCampaignSchema } from "@/lib/validation";
import { audienceWhere } from "@/lib/campaigns";
import { getSettingsMap } from "@/lib/settings";
import { sendCampaignEmail } from "@/lib/notifications";
import { getSession } from "@/lib/auth";
import type { Campaign, Registration } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 300;

type StatKey = "delivered" | "opened" | "bounced" | "complained";
type StatCounts = Record<StatKey, number>;

const emptyCounts = (): StatCounts => ({ delivered: 0, opened: 0, bounced: 0, complained: 0 });

/**
 * Returns campaigns with per-campaign delivery/open/bounce counts, plus overall
 * totals for the stats strip. Counts are per recipient: someone who opens the
 * same email five times counts as one open. These numbers come from Resend's
 * webhook, which only exists for campaigns (everything else is sent via Gmail).
 */
export async function GET() {
  const campaigns = await prisma.campaign.findMany({ orderBy: { sentAt: "desc" }, take: 50 });
  const campaignIds = campaigns.map((c: Campaign) => c.id);

  const perCampaign: Record<string, StatCounts> = {};
  const totals = emptyCounts();

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
        recipientCount: c.recipientCount,
        sentCount: c.sentCount,
        failedCount: c.failedCount,
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
 * could otherwise trip Resend's rate limit. Each recipient's outcome is
 * recorded as its own EmailEvent (source: CAMPAIGN, tagged with campaignId),
 * and a Campaign row summarizes the whole run for the history list.
 *
 * The Campaign row is created BEFORE sending so every email can carry its
 * campaign ID. That ID is what lets the webhook attribute delivered/opened/
 * bounced events to the right campaign later.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();

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

  const { audience, subject, body } = parsed.data;

  const recipients = await prisma.registration.findMany({ where: audienceWhere(audience) });
  if (recipients.length === 0) {
    return NextResponse.json({ error: "No registrations match that audience." }, { status: 400 });
  }

  const settings = await getSettingsMap();

  const campaign = await prisma.campaign.create({
    data: {
      subject,
      body,
      audience,
      recipientCount: recipients.length,
      sentCount: 0,
      failedCount: 0,
      sentByName: session?.name,
    },
  });

  let sentCount = 0;
  let failedCount = 0;

  try {
    const CONCURRENCY = 5;
    for (let i = 0; i < recipients.length; i += CONCURRENCY) {
      const batch = recipients.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((r: Registration) => sendCampaignEmail(r, subject, body, settings, campaign.id))
      );
      for (const r of results) {
        if (r.success) sentCount++;
        else failedCount++;
      }
    }
  } finally {
    // Always record what happened, even if something threw partway through
    // (for example, the function hit its time limit on a very large audience).
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { sentCount, failedCount },
    });
  }

  return NextResponse.json({
    result: "success",
    campaign: { id: campaign.id, recipientCount: recipients.length, sentCount, failedCount },
  });
}