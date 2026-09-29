import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncSource } from "@/lib/prospects";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Pulls the connected sheet(s) into the database. Body: { sourceId?: string, force?: boolean }.
 * Without sourceId, every active sheet is synced. Without force, a sheet that
 * was synced in the last few seconds is skipped, so the page can call this
 * freely on load and on a timer.
 */
export async function POST(request: NextRequest) {
  let body: { sourceId?: string; force?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // no body is fine
  }

  const sources = body.sourceId
    ? await prisma.prospectSource.findMany({ where: { id: body.sourceId } })
    : await prisma.prospectSource.findMany({ where: { active: true } });

  const results = [];
  for (const source of sources) {
    results.push(await syncSource(source.id, { force: Boolean(body.force) }));
  }

  return NextResponse.json({ results });
}
