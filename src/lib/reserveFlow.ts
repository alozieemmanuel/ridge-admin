import { reserveSeat } from "@/lib/reservations";
import { sendTicket } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";

export type ReserveFlowResult = { ok: true; alreadyReserved: boolean; emailSent: boolean } | { ok: false; reason: "NOT_FOUND" | "FULL" };

/**
 * Reserves the guest's seat and emails the ticket. Safe to call twice. A failed email never undoes the reservation.
 * Shared by the Reserve button and by passing the entry quiz.
 */
export async function completeReservation(registrationId: string, request: Request, by: "guest" | "quiz" = "guest"): Promise<ReserveFlowResult> {
  const result = await reserveSeat(registrationId);
  if (!result.ok) return { ok: false, reason: result.reason };

  let emailSent = true;
  if (!result.alreadyReserved) {
    const r = result.registration;
    const actor = { adminId: null, name: `${r.fullName} (guest)`, email: r.email };
    const entry = { entityType: "registration" as const, entityId: r.id, entityLabel: r.fullName, eventId: r.eventId };
    await logAudit(actor, { ...entry, action: "participant.reserve", details: { by } }, request);
    if (!r.email) return { ok: true, alreadyReserved: false, emailSent: false };
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
  return { ok: true, alreadyReserved: result.alreadyReserved, emailSent };
}
