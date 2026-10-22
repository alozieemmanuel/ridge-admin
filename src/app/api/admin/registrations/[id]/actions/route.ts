import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registrationActionSchema } from "@/lib/validation";
import { getSettingsMap } from "@/lib/settings";
import { getSession } from "@/lib/auth";
import { logAdminAction, type AuditAction } from "@/lib/audit";
import { missingEventDetails, sendInvitation, sendTicket } from "@/lib/notifications";
import { releaseReservation, reserveSeat } from "@/lib/reservations";

export const runtime = "nodejs";

/**
 * Actions on one participant:
 *   send_invitation / send_reminder  email the unique "Reserve My Seat" link
 *   reserve / release                reserve a seat for them, or free it again (the admin doing it on their behalf)
 *   send_ticket                      (re)send the entry ticket email
 *   check_in / undo_check_in         mark them as arrived at the entrance
 *
 * On a send failure this answers 502 with the provider's reason in `error`. Every attempt is written to the activity log.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = registrationActionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid action." }, { status: 400 });
  }
  const { action } = parsed.data;

  const registration = await prisma.registration.findUnique({ where: { id } });
  if (!registration) return NextResponse.json({ error: "Participant not found." }, { status: 404 });

  const log = (name: AuditAction, details?: Record<string, string | boolean | null>) =>
    logAdminAction(session, { action: name, entityType: "registration", entityId: id, entityLabel: registration.fullName, details: details ?? {} }, request);

  try {
    switch (action) {
      case "send_invitation":
      case "send_reminder": {
        const kind = action === "send_reminder" ? "reminder" : "invitation";
        const missing = missingEventDetails(await getSettingsMap());
        if (missing.length) {
          return NextResponse.json({ error: `Fill in the ${missing.join(" and ")} in Settings before sending invitations.` }, { status: 409 });
        }
        if (registration.reservedAt) {
          return NextResponse.json({ error: `${registration.fullName} has already reserved a seat.` }, { status: 409 });
        }
        try {
          await sendInvitation(registration, kind);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to send the email.";
          await log("participant.send_invitation", { outcome: "failed", kind, error: message.slice(0, 300) });
          return NextResponse.json({ error: message }, { status: 502 });
        }
        await log("participant.send_invitation", { outcome: "sent", kind, to: registration.email });
        return NextResponse.json({ result: "success" });
      }

      case "reserve": {
        const result = await reserveSeat(id);
        if (!result.ok) {
          return NextResponse.json(
            { error: result.reason === "FULL" ? "All seats are taken. Raise the seat limit in Attendance first." : "Participant not found." },
            { status: result.reason === "FULL" ? 409 : 404 }
          );
        }
        if (result.alreadyReserved) return NextResponse.json({ result: "success", unchanged: true });
        await log("participant.reserve", { by: "admin" });
        // The ticket goes out straight away, like when guests reserve themselves. A failed send never undoes the reservation.
        let ticketSent = true;
        let ticketError: string | null = null;
        try {
          await sendTicket(result.registration);
        } catch (err) {
          ticketSent = false;
          ticketError = err instanceof Error ? err.message : "The ticket email failed.";
        }
        return NextResponse.json({ result: "success", ticketSent, ticketError });
      }

      case "release": {
        const result = await releaseReservation(id);
        if (!result.ok) {
          return NextResponse.json(
            { error: result.reason === "CHECKED_IN" ? "This guest is already checked in. Undo the check-in first." : "Participant not found." },
            { status: result.reason === "CHECKED_IN" ? 409 : 404 }
          );
        }
        await log("participant.release");
        return NextResponse.json({ result: "success" });
      }

      case "send_ticket": {
        if (!registration.reservedAt) {
          return NextResponse.json({ error: `${registration.fullName} hasn't reserved a seat yet, so there is no ticket to send.` }, { status: 409 });
        }
        try {
          await sendTicket(registration);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to send the ticket.";
          await log("participant.send_ticket", { outcome: "failed", error: message.slice(0, 300) });
          return NextResponse.json({ error: message }, { status: 502 });
        }
        await log("participant.send_ticket", { outcome: "sent", to: registration.email });
        return NextResponse.json({ result: "success" });
      }

      case "check_in":
      case "undo_check_in": {
        const checkingIn = action === "check_in";
        if (checkingIn && !registration.reservedAt) {
          return NextResponse.json({ error: `${registration.fullName} hasn't reserved a seat. Reserve one for them first.` }, { status: 409 });
        }
        const updated = await prisma.registration.update({ where: { id }, data: { checkedInAt: checkingIn ? new Date() : null } });
        await log("registration.checkin", { checkedIn: checkingIn });
        return NextResponse.json({ result: "success", checkedInAt: updated.checkedInAt?.toISOString() ?? null });
      }

      default:
        return NextResponse.json({ error: "That action isn't available." }, { status: 400 });
    }
  } catch (err) {
    console.error("[registrations/actions] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong." }, { status: 500 });
  }
}
