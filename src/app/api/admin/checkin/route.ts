import { NextRequest, NextResponse } from "next/server";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import { checkInGuest, checkinCounts, findByCode, recentCheckins, searchGuests, undoCheckIn, walkInCheckIn, UNDO_WINDOW_MS } from "@/lib/checkin";
import { prisma } from "@/lib/prisma";
import { addOrUpdateContact } from "@/lib/contactSources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The door screen's numbers and the latest check-ins (each can be undone for a few minutes). */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "attendance", checkin: true });
  if (!ctx.ok) return ctx.response;
  const [counts, recent] = await Promise.all([checkinCounts(ctx.event.id), recentCheckins(ctx.event.id)]);
  return NextResponse.json({ ...counts, recent, undoMinutes: UNDO_WINDOW_MS / 60_000 });
}

/**
 * Body: { action: "scan", code }     look the ticket up and check the guest in at once (the QR link does this)
 *       { action: "search", q }      list matches by email, phone, name or ticket code
 *       { action: "check_in", id }   check in a guest the official picked from a search, after confirming
 *       { action: "walk_in", id }    check in a guest who is on the list but never reserved (they did not get or see the invitation)
 *       { action: "walk_in_new", fullName, email, phone? }  add someone who is not on the list at all, give them a seat and check them in
 *       { action: "undo", id }       take a check-in back (door staff: within a few minutes)
 * Every check-in and undo is written to the activity log with the official's name.
 */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "attendance", checkin: true });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;

  let b: { action?: string; code?: string; q?: string; id?: string; fullName?: string; email?: string; phone?: string };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const log = (checkedIn: boolean, id: string, label: string, via: string) =>
    logAdminAction(session, { action: "registration.checkin", entityType: "registration", entityId: id, entityLabel: label, details: { checkedIn, via, by: session.name } }, request);

  switch (b.action) {
    case "scan": {
      const found = await findByCode(event.id, String(b.code || ""));
      if (!found) return NextResponse.json({ state: "not_found", guest: null });
      const r = await checkInGuest(event.id, found.id, session.name);
      if (r.state === "checked_in") await log(true, found.id, found.fullName, "scan");
      return NextResponse.json(r);
    }
    case "check_in": {
      if (!b.id) return NextResponse.json({ error: "No guest chosen." }, { status: 400 });
      const r = await checkInGuest(event.id, String(b.id), session.name);
      if (r.state === "checked_in" && r.guest) await log(true, r.guest.id, r.guest.fullName, "search");
      return NextResponse.json(r);
    }
    case "walk_in": {
      if (!b.id) return NextResponse.json({ error: "No guest chosen." }, { status: 400 });
      const r = await walkInCheckIn(event.id, String(b.id), session.name);
      if (r.state === "checked_in" && r.guest) await log(true, r.guest.id, r.guest.fullName, r.walkIn ? "walk_in" : "search");
      return NextResponse.json(r);
    }
    case "walk_in_new": {
      const fullName = String(b.fullName || "").trim().slice(0, 200);
      const email = String(b.email || "").trim();
      const phone = String(b.phone || "").trim().slice(0, 60);
      if (!fullName) return NextResponse.json({ error: "Enter the name." }, { status: 400 });
      if (!email && !event.emailOptional) return NextResponse.json({ error: "Enter the email address." }, { status: 400 });
      const saved = await addOrUpdateContact(event.id, { fullName, email, phone }, `Added at the door by ${session.name}`, { emailOptional: event.emailOptional });
      if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 400 });
      const person = await prisma.registration.findFirst({
        where: email ? { eventId: event.id, email: email.toLowerCase() } : { eventId: event.id, email: "", fullName: fullName.replace(/\s+/g, " ") },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!person) return NextResponse.json({ error: "Could not add this person. Try again." }, { status: 500 });
      const r = await walkInCheckIn(event.id, person.id, session.name);
      if (r.state === "checked_in" && r.guest) await log(true, r.guest.id, r.guest.fullName, saved.result === "added" ? "walk_in_new" : "walk_in");
      return NextResponse.json({ ...r, added: saved.result === "added" });
    }
    case "undo": {
      if (!b.id) return NextResponse.json({ error: "No guest chosen." }, { status: 400 });
      const r = await undoCheckIn(event.id, String(b.id), session.role === "CHECKIN");
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
      await log(false, r.guest.id, r.guest.fullName, "undo");
      return NextResponse.json({ ok: true, guest: r.guest });
    }
    case "search": {
      const guests = await searchGuests(event.id, String(b.q || ""));
      return NextResponse.json({ guests });
    }
    default:
      return NextResponse.json({ error: "That action isn't available." }, { status: 400 });
  }
}
