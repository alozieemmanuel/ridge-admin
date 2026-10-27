import { NextRequest, NextResponse } from "next/server";
import { isPower } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit";
import { requireEvent, forgetEvent } from "@/lib/event";
import { pingUrl } from "@/lib/sheetPing";
import { getSheetState, saveSheetInterval, saveSheetUrl, syncContactSheet } from "@/lib/contactSheet";

export const runtime = "nodejs";
export const maxDuration = 120;

/** The event's live sheet: the saved link and how the last sync went. */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const state = await getSheetState(ctx.event.id);
  // Only owners get the private address that makes the sheet update instantly (see src/lib/sheetPing.ts).
  const ping = ctx.session.role === "OWNER" && state.url ? { url: pingUrl(ctx.event.slug, ctx.event.id) } : undefined;
  return NextResponse.json({ ...state, ping });
}

/** Saves the event's sheet link. Body: { url: string, interval?: minutes }. An empty url removes the link. */
export async function PUT(request: NextRequest) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;
  let body: { url?: unknown; interval?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body.url !== "string") return NextResponse.json({ error: "Paste the sheet link." }, { status: 400 });

  const saved = await saveSheetUrl(event.id, body.url);
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });
  if (body.url.trim() && typeof body.interval === "number") await saveSheetInterval(event.id, body.interval);
  // Linking a sheet makes it the event's source, so the scheduled sync reads it.
  if (body.url.trim() && event.dataSource !== "sheet") await prisma.event.update({ where: { id: event.id }, data: { dataSource: "sheet" } });
  forgetEvent();

  await logAdminAction(session, { action: "contacts.sheet_link", entityType: "data", eventId: event.id, details: { linked: Boolean(body.url.trim()) } }, request);
  return NextResponse.json({ result: "saved", ...(await getSheetState(event.id)) });
}

/**
 * Reads the event's saved sheet and adds or updates its contacts. Nobody is emailed.
 * Body: { auto?: boolean, replace?: boolean, confirm?: "DELETE" }
 *   auto     the page's own timer; skipped when the last sync was under two minutes ago.
 *   replace  owner only, needs confirm "DELETE": deletes every contact of this event first, then loads the sheet.
 */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;
  let body: { auto?: unknown; replace?: unknown; confirm?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // no body is fine
  }

  const replace = body.replace === true;
  if (replace) {
    if (!isPower(session.role)) return NextResponse.json({ error: "Only an owner can delete all contacts." }, { status: 403 });
    if (body.confirm !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });
  }

  try {
    const result = await syncContactSheet(event.id, { replace, minGapMs: body.auto === true ? 120_000 : undefined });
    if ("skipped" in result) return NextResponse.json({ result: "skipped" });
    // Quiet automatic runs that change nothing do not fill the activity log.
    if (body.auto !== true || result.added || result.updated) {
      await logAdminAction(
        session,
        {
          action: "contacts.sheet_sync",
          entityType: "data",
          eventId: event.id,
          details: { replace, rows: result.rows ?? 0, added: result.added ?? 0, updated: result.updated ?? 0, problems: result.problemCount ?? 0, auto: body.auto === true },
        },
        request
      );
    }
    return NextResponse.json({ result: "synced", ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The sync failed." }, { status: 502 });
  }
}
