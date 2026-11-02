import { NextRequest, NextResponse } from "next/server";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import { checkInGuest, checkinCounts, findByCode, recentCheckins, searchGuests, undoCheckIn, UNDO_WINDOW_MS } from "@/lib/checkin";

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
 *       { action: "undo", id }       take a check-in back (door staff: within a few minutes)
 * Every check-in and undo is written to the activity log with the official's name.
 */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "attendance", checkin: true });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;

  let b: { action?: string; code?: string; q?: string; id?: string };
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
