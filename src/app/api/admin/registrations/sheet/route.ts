import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { getSheetState, saveSheetUrl, syncContactSheet } from "@/lib/contactSheet";

export const runtime = "nodejs";
export const maxDuration = 120;

/** The live sheet: the saved link and how the last sync went. */
export async function GET() {
  return NextResponse.json(await getSheetState());
}

/** Saves the sheet link. Body: { url: string }. An empty url removes the link. */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body.url !== "string") return NextResponse.json({ error: "Paste the sheet link." }, { status: 400 });

  const saved = await saveSheetUrl(body.url);
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });

  await logAdminAction(session, { action: "contacts.sheet_link", entityType: "data", details: { linked: Boolean(body.url.trim()) } }, request);
  return NextResponse.json({ result: "saved", ...(await getSheetState()) });
}

/**
 * Reads the saved sheet and adds or updates contacts. Nobody is emailed.
 * Body: { auto?: boolean, replace?: boolean, confirm?: "DELETE" }
 *   auto     the page's own timer; skipped when the last sync was under two minutes ago.
 *   replace  owner only, needs confirm "DELETE": deletes every contact first, then loads the sheet.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  let body: { auto?: unknown; replace?: unknown; confirm?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // no body is fine
  }

  const replace = body.replace === true;
  if (replace) {
    if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Only an owner can delete all contacts." }, { status: 403 });
    if (body.confirm !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });
  }

  try {
    const result = await syncContactSheet({ replace, minGapMs: body.auto === true ? 120_000 : undefined });
    if ("skipped" in result) return NextResponse.json({ result: "skipped" });
    // Quiet automatic runs that change nothing do not fill the activity log.
    if (body.auto !== true || result.added || result.updated) {
      await logAdminAction(
        session,
        {
          action: "contacts.sheet_sync",
          entityType: "data",
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
