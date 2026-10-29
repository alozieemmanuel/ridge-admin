import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { drainEmailQueue } from "@/lib/emailQueue";
import { canAccessEvent } from "@/lib/event";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * "Send waiting emails now": one short run (about 40 seconds) of the queue. The page calls it again until nothing is waiting.
 * Body (optional): { campaignId } to work on one campaign only. Any signed-in admin who can open that campaign's event.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const campaignId = typeof body.campaignId === "string" && body.campaignId ? body.campaignId : undefined;
  if (campaignId) {
    const c = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { eventId: true } });
    if (!c || !(await canAccessEvent(session, c.eventId))) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  const result = await drainEmailQueue({ campaignId, budgetMs: 40_000 });
  // One log line per run would flood the log during a big send: only runs that did something, or hit a problem, are written.
  if (result.sent || result.failed || result.blocked) {
    await logAdminAction(session, { action: "email.queue_flush", entityType: "sender", entityLabel: "Waiting emails", eventId: null, details: { ...result } }, request);
  }
  return NextResponse.json({ result: "success", ...result });
}
