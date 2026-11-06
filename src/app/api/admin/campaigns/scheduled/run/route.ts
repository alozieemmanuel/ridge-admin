import { NextRequest, NextResponse } from "next/server";
import { requireEvent } from "@/lib/event";
import { runDueCampaigns } from "@/lib/scheduledCampaigns";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Sends this event's campaigns whose time has come. The Campaigns page asks for this while it is open, as a back-up for the timer. */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "campaigns" });
  if (!ctx.ok) return ctx.response;
  try {
    return NextResponse.json({ ok: true, ...(await runDueCampaigns({ eventId: ctx.event.id })) });
  } catch {
    return NextResponse.json({ ok: true, ran: 0, results: [] });
  }
}
