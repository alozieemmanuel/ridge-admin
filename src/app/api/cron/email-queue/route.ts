import { NextRequest, NextResponse } from "next/server";
import { drainEmailQueue } from "@/lib/emailQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sends the campaign emails that were waiting because every sender had used its daily limit. Safe to call often:
 * when no sender has room it does nothing. Protected by CRON_SECRET (Authorization: Bearer <secret> or ?key=<secret>).
 * Call it every 15 minutes from the same scheduler as the sheet sync.
 */
async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.nextUrl.searchParams.get("key") || "";
  if (given !== secret) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const result = await drainEmailQueue({ max: 400 });
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
