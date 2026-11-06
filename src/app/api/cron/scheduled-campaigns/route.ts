import { NextRequest, NextResponse } from "next/server";
import { runDueCampaigns } from "@/lib/scheduledCampaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sends every scheduled campaign whose time has come, for every event. Safe to call often: with nothing due it does nothing.
 * Protected by CRON_SECRET (Authorization: Bearer <secret> or ?key=<secret>). Call it every 5 minutes from an outside timer.
 */
async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.nextUrl.searchParams.get("key") || "";
  if (given !== secret) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const result = await runDueCampaigns();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
