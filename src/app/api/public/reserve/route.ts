import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettingsMap } from "@/lib/settings";
import { verifyReserveToken } from "@/lib/proof-token";
import { getCapacity, reserveSeat } from "@/lib/reservations";
import { sendTicket } from "@/lib/notifications";
import { ticketQrSvg } from "@/lib/ticket";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BAD_LINK = "This link isn't valid. Please use the link in your most recent invitation email, or contact the team.";

async function view(registrationId: string) {
  const [r, settings, capacity, taken] = await Promise.all([
    prisma.registration.findUnique({ where: { id: registrationId } }),
    getSettingsMap(),
    getCapacity(),
    prisma.registration.count({ where: { reservedAt: { not: null } } }),
  ]);
  if (!r) return null;
  const reserved = Boolean(r.reservedAt && r.ticketCode);
  return {
    guest: { fullName: r.fullName, email: r.email, phone: r.phone || null },
    event: {
      name: settings.programme_name,
      caption: settings.event_caption,
      date: settings.event_date,
      time: settings.event_time,
      venue: settings.event_venue,
      contactEmail: settings.contact_email,
      contactPhone: settings.contact_phone,
    },
    reserved,
    full: !reserved && capacity !== null && taken >= capacity,
    ticket: reserved
      ? { code: r.ticketCode, qrSvg: await ticketQrSvg(r.ticketCode!), checkedIn: Boolean(r.checkedInAt) }
      : null,
  };
}

/** What a guest sees on their unique link: their details, the event, and (once reserved) their ticket. */
export async function GET(request: NextRequest) {
  const id = verifyReserveToken(request.nextUrl.searchParams.get("t") || "");
  if (!id) return NextResponse.json({ error: BAD_LINK }, { status: 400 });
  const data = await view(id);
  if (!data) return NextResponse.json({ error: "We couldn't find your invitation. Please contact the team." }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

/** "Reserve My Seat". Safe to press twice. The ticket is emailed straight away; a failed email never undoes the reservation. */
export async function POST(request: NextRequest) {
  let body: { t?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const id = verifyReserveToken(String(body.t || ""));
  if (!id) return NextResponse.json({ error: BAD_LINK }, { status: 400 });

  const result = await reserveSeat(id);
  if (!result.ok) {
    if (result.reason === "NOT_FOUND") return NextResponse.json({ error: "We couldn't find your invitation. Please contact the team." }, { status: 404 });
    return NextResponse.json({ error: "Sorry, all the seats have now been taken.", code: "FULL" }, { status: 409 });
  }

  let emailSent = true;
  if (!result.alreadyReserved) {
    const r = result.registration;
    const actor = { adminId: null, name: `${r.fullName} (guest)`, email: r.email };
    const entry = { entityType: "registration" as const, entityId: r.id, entityLabel: r.fullName };
    await logAudit(actor, { ...entry, action: "participant.reserve", details: { by: "guest" } }, request);
    try {
      await sendTicket(r);
      await logAudit({ adminId: null, name: "System" }, { ...entry, action: "participant.send_ticket", details: { outcome: "sent", to: r.email } }, request);
    } catch (err) {
      emailSent = false;
      console.error("[reserve] Ticket email failed:", err);
      await logAudit(
        { adminId: null, name: "System" },
        { ...entry, action: "participant.send_ticket", details: { outcome: "failed", error: (err instanceof Error ? err.message : "The ticket email failed.").slice(0, 300) } },
        request
      );
    }
  } else {
    emailSent = Boolean(result.registration.ticketSentAt);
  }

  const data = await view(id);
  return NextResponse.json({ result: "success", alreadyReserved: result.alreadyReserved, emailSent, ...data });
}
