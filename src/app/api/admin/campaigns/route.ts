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

export async function GET() {
  const campaigns = await prisma.campaign.findMany({ orderBy: { sentAt: "desc" }, take: 50 });
  return NextResponse.json({
    campaigns: campaigns.map((c: Campaign) => ({
      id: c.id,
      subject: c.subject,
      audience: c.audience,
      recipientCount: c.recipientCount,
      sentCount: c.sentCount,
      failedCount: c.failedCount,
      sentAt: c.sentAt.toISOString(),
      sentByName: c.sentByName,
    })),
  });
}

/**
 * Sends a one-off broadcast (subject + plain-text body) to every registration
 * matching the chosen audience segment. Sends are batched with a small
 * concurrency limit rather than all at once, since a large audience (500+)
 * could otherwise trip Resend's rate limit. Each recipient's outcome is
 * recorded as its own EmailEvent (source: CAMPAIGN), and a Campaign row
 * summarizes the whole run for the history list.
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

  let sentCount = 0;
  let failedCount = 0;
  const CONCURRENCY = 5;
  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    const batch = recipients.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((r: Registration) => sendCampaignEmail(r, subject, body, settings))
    );
    for (const r of results) {
      if (r.success) sentCount++;
      else failedCount++;
    }
  }

  const campaign = await prisma.campaign.create({
    data: {
      subject,
      body,
      audience,
      recipientCount: recipients.length,
      sentCount,
      failedCount,
      sentByName: session?.name,
    },
  });

  return NextResponse.json({
    result: "success",
    campaign: { id: campaign.id, recipientCount: recipients.length, sentCount, failedCount },
  });
}
