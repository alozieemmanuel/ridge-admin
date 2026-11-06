import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scheduleCampaignSchema } from "@/lib/validation";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import type { ScheduledItem } from "@/lib/scheduledCampaigns";

export const runtime = "nodejs";

const NOT_READY = "Scheduling needs one database update. Run: npx prisma migrate deploy";

/** The scheduled campaigns of this event: waiting ones first, then the latest finished ones. */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "campaigns" });
  if (!ctx.ok) return ctx.response;
  try {
    const rows = await prisma.scheduledCampaign.findMany({ where: { eventId: ctx.event.id }, orderBy: { runAt: "desc" }, take: 40 });
    const items: ScheduledItem[] = rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      audience: r.audience,
      category: r.category,
      runAt: r.runAt.toISOString(),
      status: r.status,
      resultMessage: r.resultMessage,
      createdByName: r.createdByName,
      finishedAt: r.finishedAt?.toISOString() ?? null,
    }));
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [], unavailable: NOT_READY });
  }
}

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
  const parsed = scheduleCampaignSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payload." }, { status: 400 });
  const { audience, subject, body, ctaLabel, runAt } = parsed.data;
  const when = new Date(runAt);
  if (when.getTime() < Date.now() + 60_000) return NextResponse.json({ error: "Pick a time at least a minute from now." }, { status: 400 });
  if (when.getTime() > Date.now() + 365 * 86_400_000) return NextResponse.json({ error: "Pick a time within the next year." }, { status: 400 });

  try {
    const row = await prisma.scheduledCampaign.create({
      data: { eventId: event.id, subject, body, audience, category: parsed.data.category || null, ctaLabel: ctaLabel ?? null, runAt: when, createdByName: session.name },
    });
    await logAdminAction(session, { action: "campaign.schedule", entityType: "campaign", entityId: row.id, entityLabel: subject, eventId: event.id, details: { subject, audience, runAt: when.toISOString() } }, request);
    return NextResponse.json({ result: "success", id: row.id, runAt: when.toISOString() });
  } catch {
    return NextResponse.json({ error: NOT_READY }, { status: 503 });
  }
}
