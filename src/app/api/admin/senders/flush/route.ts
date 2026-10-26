import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { drainEmailQueue } from "@/lib/emailQueue";

export const runtime = "nodejs";
export const maxDuration = 300;

/** "Send waiting emails now": sends what the senders still have room for. Any signed-in admin. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const result = await drainEmailQueue({ max: 300 });
  await logAdminAction(session, { action: "email.queue_flush", entityType: "sender", entityLabel: "Waiting emails", eventId: null, details: { ...result } }, request);
  return NextResponse.json({ result: "success", ...result });
}
