import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit";
import { MODULE_KEYS, requireEvent } from "@/lib/event";
import { cleanColor, cleanLink, cleanTerms, cleanText, cleanTimezone, cleanType } from "@/lib/eventInput";
import { termsOf } from "@/lib/eventTheme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The open event, for the dashboard shell: its name, brand, wording, which parts are on, and who is looking. */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;
  return NextResponse.json({
    event: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      status: event.status,
      modules: event.modules,
      type: event.type,
      brandName: event.brandName,
      color: event.color,
      logoUrl: event.logoUrl,
      logoDarkUrl: event.logoDarkUrl,
      terms: termsOf(event.terms),
      timezone: event.timezone,
    },
    role: session.role,
    admin: { name: session.name, email: session.email },
  });
}

/**
 * Owner only. Body (all optional): modules[], status ("DRAFT" | "ACTIVE" | "ARCHIVED"), type, brandName, color (hex, or null for the default),
 * logoUrl / logoDarkUrl (https links, "" to remove), terms { person, people, action }, timezone.
 * The event's name is changed in Settings, Event details. Logo files are uploaded to /api/admin/event/logo.
 */
export async function PATCH(request: NextRequest) {
  const ctx = await requireEvent(request, { owner: true });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const data: Prisma.EventUpdateInput = {};
  if (Array.isArray(b.modules)) {
    // Parts that are not offered in the form (WhatsApp, for now) are kept as they are.
    const chosen = b.modules.filter((m): m is string => typeof m === "string" && MODULE_KEYS.includes(m));
    data.modules = Array.from(new Set([...event.modules.filter((m) => !MODULE_KEYS.includes(m)), ...chosen]));
  }
  if (b.status === "ACTIVE" || b.status === "ARCHIVED" || b.status === "DRAFT") data.status = b.status;
  if ("type" in b) {
    const t = cleanType(b.type);
    if (t) data.type = t;
  }
  if ("brandName" in b) data.brandName = cleanText(b.brandName, 80) || null;
  if ("color" in b) {
    const c = cleanColor(b.color);
    if (c === undefined) return NextResponse.json({ error: "That colour isn't valid. Use a hex code like #DC2626." }, { status: 400 });
    data.color = c;
  }
  for (const key of ["logoUrl", "logoDarkUrl"] as const) {
    if (!(key in b)) continue;
    const raw = b[key];
    // An uploaded logo keeps its own address; only links typed by an admin are checked.
    if (typeof raw === "string" && raw.startsWith("/api/public/event-logo/")) continue;
    const link = cleanLink(raw);
    if (link === null) return NextResponse.json({ error: "A logo link must start with https://." }, { status: 400 });
    data[key] = link || null;
    // Replacing an uploaded logo with a link (or removing it) also deletes the uploaded file.
    await prisma.eventAsset.deleteMany({ where: { id: `${event.id}:${key === "logoUrl" ? "light" : "dark"}` } });
  }
  if ("terms" in b) data.terms = { ...cleanTerms(b.terms) };
  if ("timezone" in b) {
    const tz = cleanTimezone(b.timezone);
    if (tz) data.timezone = tz;
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const updated = await prisma.event.update({ where: { id: event.id }, data });
  await logAdminAction(session, { action: "event.update", entityType: "event", entityId: event.id, entityLabel: event.name, eventId: event.id, details: { changed: Object.keys(data) } }, request);
  return NextResponse.json({
    result: "success",
    event: { id: updated.id, slug: updated.slug, name: updated.name, status: updated.status, modules: updated.modules },
  });
}
