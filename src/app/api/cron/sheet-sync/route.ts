import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SHEET_URL_KEY, getSheetInterval, syncContactSheet } from "@/lib/contactSheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Reads every connected live sheet on the server, so new registrations arrive even when nobody has the dashboard open.
 * Each event is read only when its own interval (Contacts page, Live sheet) has passed. Nobody is emailed.
 *
 * Protected by CRON_SECRET: send it as "Authorization: Bearer <secret>" or as ?key=<secret>.
 * Call this address every 5 minutes from any scheduler (cron-job.org, GitHub Actions, Vercel Cron on a paid plan).
 */
async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.nextUrl.searchParams.get("key") || "";
  if (given !== secret) return NextResponse.json({ error: "Not allowed." }, { status: 401 });

  const linked = await prisma.setting.findMany({ where: { key: SHEET_URL_KEY, value: { not: "" }, event: { status: { not: "ARCHIVED" } } }, select: { eventId: true, event: { select: { slug: true } } } });
  const started = Date.now();
  const results: { event: string; result: string }[] = [];

  for (const row of linked) {
    if (Date.now() - started > 240_000) {
      results.push({ event: row.event.slug, result: "skipped: out of time, next run" });
      continue;
    }
    const minutes = await getSheetInterval(row.eventId);
    if (minutes === 0) {
      results.push({ event: row.event.slug, result: "manual only" });
      continue;
    }
    try {
      // A little under the interval, so a run that lands a few seconds early is not skipped.
      const res = await syncContactSheet(row.eventId, { minGapMs: Math.max(0, minutes * 60_000 - 30_000) });
      results.push({ event: row.event.slug, result: "skipped" in res ? "not due yet" : `${res.added ?? 0} added, ${res.updated ?? 0} updated` });
    } catch (err) {
      results.push({ event: row.event.slug, result: `failed: ${err instanceof Error ? err.message : "unknown error"}` });
    }
  }
  return NextResponse.json({ ok: true, events: results });
}

export const GET = run;
export const POST = run;
