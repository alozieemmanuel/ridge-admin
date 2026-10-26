import { NextResponse } from "next/server";
import type { Event } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession, type SessionPayload } from "@/lib/auth";
import { RESERVED_SLUGS } from "@/lib/basePath";

import { EVENT_MODULES, MODULE_KEYS, type ModuleKey } from "@/lib/eventModules";
export { EVENT_MODULES, MODULE_KEYS };
export type { ModuleKey };

/** "Investors Hangout 2026!" becomes "investors-hangout-2026". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function validateSlug(slug: string): string | null {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 2 || slug.length > 60) return "Use 2 to 60 letters, numbers and single dashes, for example investor-hangout.";
  if (RESERVED_SLUGS.includes(slug)) return `"${slug}" is used by the dashboard itself. Choose another address.`;
  return null;
}

export type EventContext =
  | { ok: true; session: SessionPayload; event: Event }
  | { ok: false; response: NextResponse };

const fail = (error: string, status: number): { ok: false; response: NextResponse } => ({ ok: false, response: NextResponse.json({ error }, { status }) });

/** True when this admin may open the event: owners open every event, other admins only the events they were added to. */
export async function canAccessEvent(session: SessionPayload, eventId: string): Promise<boolean> {
  if (session.role === "OWNER") return true;
  // A draft is for owners only.
  return Boolean(await prisma.eventAdmin.findFirst({ where: { eventId, adminId: session.adminId, event: { status: { not: "DRAFT" } } }, select: { adminId: true } }));
}

/**
 * The first line of every event-scoped API route. It works out which event the request is about (the x-event header the
 * dashboard adds, or ?event=<slug> for plain download links), checks the admin is signed in and has access to THAT event,
 * and optionally that a module is switched on or that the admin is an owner.
 *
 *   const ctx = await requireEvent(request);
 *   if (!ctx.ok) return ctx.response;
 *   const { event, session } = ctx;
 */
// An event row is asked for by almost every request, so each server instance keeps it for a few seconds. Saving the event clears it.
const eventMemo = new Map<string, { at: number; row: Awaited<ReturnType<typeof readEvent>> }>();
const EVENT_TTL_MS = 5_000;
function readEvent(slug: string) {
  return prisma.event.findUnique({ where: { slug } });
}
async function findEventBySlug(slug: string) {
  const hit = eventMemo.get(slug);
  if (hit && Date.now() - hit.at < EVENT_TTL_MS) return hit.row;
  const row = await readEvent(slug);
  if (row) eventMemo.set(slug, { at: Date.now(), row });
  return row;
}
/** Call after the event is changed so the next request sees the change at once. */
export function forgetEvent(slug?: string): void {
  if (slug) eventMemo.delete(slug);
  else eventMemo.clear();
}

export async function requireEvent(request: Request, opts: { module?: ModuleKey | ModuleKey[]; owner?: boolean } = {}): Promise<EventContext> {
  const session = await getSession();
  if (!session) return fail("Not signed in.", 401);

  const url = new URL(request.url);
  const slug = (request.headers.get("x-event") || url.searchParams.get("event") || "").trim().toLowerCase();
  if (!slug) return fail("No event was chosen.", 400);

  const event = await findEventBySlug(slug);
  if (!event) return fail("That event does not exist.", 404);
  if (!(await canAccessEvent(session, event.id))) return fail("You don't have access to this event.", 403);
  if (opts.owner && session.role !== "OWNER") return fail("Only an owner can do this.", 403);

  if (opts.module) {
    const wanted = Array.isArray(opts.module) ? opts.module : [opts.module];
    if (!wanted.some((m) => event.modules.includes(m))) return fail("That part is not switched on for this event.", 404);
  }
  return { ok: true, session, event };
}

/** Looks a contact up inside one event. A contact from another event is "not found", whatever its id. */
export async function findContact(id: string, eventId: string) {
  return prisma.registration.findFirst({ where: { id, eventId } });
}

const slugToId = new Map<string, string>();
/** The id of the event behind a slug (remembered, because the activity log asks on every write). */
export async function eventIdForSlug(slug: string): Promise<string | null> {
  const known = slugToId.get(slug);
  if (known) return known;
  const row = await prisma.event.findUnique({ where: { slug }, select: { id: true } });
  if (row) slugToId.set(slug, row.id);
  return row?.id ?? null;
}

/** For the few switched-off modules that predate events (brochure and public registration forms): the oldest event. */
export async function firstEventId(): Promise<string> {
  const row = await prisma.event.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!row) throw new Error("There is no event yet. Create one first.");
  return row.id;
}
