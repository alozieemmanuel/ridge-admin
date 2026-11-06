import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";

export const runtime = "nodejs";

/** Cancels a scheduled campaign that has not started yet. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEvent(request, { module: "campaigns" });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;
  const { id } = await params;
  const row = await prisma.scheduledCampaign.findFirst({ where: { id, eventId: event.id } });
  if (!row) return NextResponse.json({ error: "Scheduled campaign not found." }, { status: 404 });
  const res = await prisma.scheduledCampaign.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", finishedAt: new Date(), resultMessage: `Cancelled by ${session.name}.` } });
  if (res.count !== 1) return NextResponse.json({ error: "It has already started or finished, so it can't be cancelled." }, { status: 409 });
  await logAdminAction(session, { action: "campaign.unschedule", entityType: "campaign", entityId: id, entityLabel: row.subject, eventId: event.id, details: { subject: row.subject, runAt: row.runAt.toISOString() } }, request);
  return NextResponse.json({ result: "success" });
}
