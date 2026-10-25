import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit";
import { clearDataSchema } from "@/lib/validation";
import { requireEvent } from "@/lib/event";

export const runtime = "nodejs";

/**
 * Bulk delete for ONE event (owner only). Requires { target, confirm: "DELETE" } in the body.
 *
 *   registrations  every contact of this event, with their follow-up logs, email history and tickets.
 *   everything     the contacts AND this event's campaigns and activity log.
 *
 * Other events are never touched. The event itself, its settings, its email templates and the admin accounts stay.
 * One entry is written to the activity log afterwards, so there is a record of who cleared what.
 */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { owner: true });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = clearDataSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request." }, { status: 400 });
  }

  if (parsed.data.target === "registrations") {
    const guests = await prisma.registration.deleteMany({ where: { eventId: event.id } });
    await logAdminAction(session, { action: "data.clear", entityType: "data", eventId: event.id, details: { scope: "registrations", registrations: guests.count } }, request);
    return NextResponse.json({ result: "success", deleted: { registrations: guests.count } });
  }

  // Everything of this event, all or nothing. Deleting a contact or a campaign also removes its email history.
  const [guests, campaigns] = await prisma.$transaction([
    prisma.registration.deleteMany({ where: { eventId: event.id } }),
    prisma.campaign.deleteMany({ where: { eventId: event.id } }),
    prisma.auditLog.deleteMany({ where: { eventId: event.id } }),
  ]);

  await logAdminAction(session, { action: "data.clear", entityType: "data", eventId: event.id, details: { scope: "everything", registrations: guests.count, campaigns: campaigns.count } }, request);
  return NextResponse.json({ result: "success", deleted: { registrations: guests.count, campaigns: campaigns.count } });
}
