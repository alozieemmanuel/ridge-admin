import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit";
import { requireEvent, forgetEvent } from "@/lib/event";
import { getSheetState, saveSheetInterval } from "@/lib/contactSheet";
import { appBaseUrl } from "@/lib/email";
import { BASE_PATH } from "@/lib/basePath";
import { INTAKE_ORIGINS_KEY, clearSupabase, getSupabaseState, isDataSource, newIntakeToken, saveSupabase, syncSupabase } from "@/lib/contactSources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function state(eventId: string, slug: string, dataSource: string, token: string | null) {
  const [sheet, supabase, origins] = await Promise.all([
    getSheetState(eventId),
    getSupabaseState(eventId),
    prisma.setting.findUnique({ where: { eventId_key: { eventId, key: INTAKE_ORIGINS_KEY } } }),
  ]);
  return {
    dataSource,
    sheet,
    supabase,
    form: { endpoint: `${appBaseUrl()}${BASE_PATH}/api/public/intake/${slug}`, key: token ?? "", origins: origins?.value ?? "" },
  };
}

/** Owner only. The event's data source and its settings. The Supabase key is never returned, only whether one is saved. */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { owner: true });
  if (!ctx.ok) return ctx.response;
  const { event } = ctx;
  return NextResponse.json(await state(event.id, event.slug, event.dataSource, event.intakeToken));
}

/**
 * Owner only.
 *   PUT  { dataSource, supabase?: { url, table, key? }, origins?: string }   choose the source and save its settings
 *   POST { action: "regenerate_key" | "sync_supabase" }                       change the form key, or read the Supabase table now
 */
export async function PUT(request: NextRequest) {
  const ctx = await requireEvent(request, { owner: true });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;
  let b: { dataSource?: unknown; interval?: unknown; supabase?: { url?: unknown; table?: unknown; key?: unknown }; origins?: unknown };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!isDataSource(b.dataSource)) return NextResponse.json({ error: "Choose where the contacts come from." }, { status: 400 });

  if (b.dataSource === "supabase") {
    const s = b.supabase ?? {};
    const saved = await saveSupabase(event.id, { url: String(s.url ?? ""), table: String(s.table ?? ""), key: typeof s.key === "string" ? s.key : "" });
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });
  }
  if (typeof b.interval === "number") await saveSheetInterval(event.id, b.interval);
  if (typeof b.origins === "string") {
    const value = b.origins.slice(0, 1000);
    if (value.trim()) await prisma.setting.upsert({ where: { eventId_key: { eventId: event.id, key: INTAKE_ORIGINS_KEY } }, update: { value }, create: { eventId: event.id, key: INTAKE_ORIGINS_KEY, value } });
    else await prisma.setting.deleteMany({ where: { eventId: event.id, key: INTAKE_ORIGINS_KEY } });
  }

  const token = b.dataSource === "form" ? event.intakeToken ?? newIntakeToken() : event.intakeToken;
  const updated = await prisma.event.update({ where: { id: event.id }, data: { dataSource: b.dataSource, intakeToken: token } });
  forgetEvent();
  if (b.dataSource !== "supabase" && event.dataSource === "supabase") await clearSupabase(event.id);

  await logAdminAction(session, { action: "event.source", entityType: "event", entityId: event.id, entityLabel: event.name, eventId: event.id, details: { dataSource: b.dataSource } }, request);
  return NextResponse.json({ result: "saved", ...(await state(event.id, event.slug, updated.dataSource, updated.intakeToken)) });
}

export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { owner: true });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;
  let b: { action?: unknown };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (b.action === "regenerate_key") {
    const updated = await prisma.event.update({ where: { id: event.id }, data: { intakeToken: newIntakeToken() } });
    forgetEvent();
    await logAdminAction(session, { action: "event.source", entityType: "event", entityId: event.id, entityLabel: event.name, eventId: event.id, details: { form_key: "changed" } }, request);
    return NextResponse.json({ result: "saved", ...(await state(event.id, event.slug, updated.dataSource, updated.intakeToken)) });
  }

  if (b.action === "sync_supabase") {
    try {
      const result = await syncSupabase(event.id);
      if ("skipped" in result) return NextResponse.json({ result: "skipped" });
      await logAdminAction(session, { action: "contacts.sheet_sync", entityType: "data", eventId: event.id, details: { source: "supabase", rows: result.rows ?? 0, added: result.added ?? 0, updated: result.updated ?? 0 } }, request);
      return NextResponse.json({ result: "synced", ...result });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "The sync failed." }, { status: 502 });
    }
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
