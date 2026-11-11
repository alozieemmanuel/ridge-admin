import { NextRequest, NextResponse } from "next/server";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import { checkedInWithoutTestEmail, sendTestInviteOnCheckIn } from "@/lib/testInvite";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUDGET_MS = 45_000;
const PARALLEL = 4;

/** Counts: how many checked-in guests have the welcome and test email, and how many still do not. */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "tests" });
  if (!ctx.ok) return ctx.response;
  const r = await checkedInWithoutTestEmail(ctx.event.id);
  return NextResponse.json({ checkedIn: r.checkedIn, emailed: r.emailed, waiting: r.ids.length });
}

/** Sends the welcome and test email to checked-in guests who have not had it. Works in a time budget, so press again if some are left. */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "tests" });
  if (!ctx.ok) return ctx.response;
  const { ids } = await checkedInWithoutTestEmail(ctx.event.id);
  const started = Date.now();
  let sent = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < ids.length && Date.now() - started < BUDGET_MS) {
      const id = ids[next++];
      const r = await sendTestInviteOnCheckIn(id);
      if (r === "sent") sent++;
      else if (r === "failed") failed++;
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  await logAdminAction(ctx.session, { action: "test.settings", entityType: "test", details: { invites: "sent", sent, failed } as never }, request);
  return NextResponse.json({ sent, failed, left: Math.max(0, ids.length - next) });
}
