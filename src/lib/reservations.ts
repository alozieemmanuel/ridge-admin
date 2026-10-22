import { prisma } from "@/lib/prisma";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { generateTicketCode } from "@/lib/ticket";
import type { Registration } from "@prisma/client";

/** The seat limit from Settings. null means no limit (the field was left empty or isn't a positive number). */
export function parseCapacity(raw: string | null | undefined): number | null {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getCapacity(): Promise<number | null> {
  const row = await prisma.setting.findUnique({ where: { key: "seat_capacity" } });
  return parseCapacity(row ? row.value : DEFAULT_SETTINGS.seat_capacity);
}

export type ReserveResult =
  | { ok: true; registration: Registration; alreadyReserved: boolean }
  | { ok: false; reason: "NOT_FOUND" | "FULL" };

// Any fixed number: it only has to be the same for every reservation, so two people reserving the
// last seat at the same moment are handled one after the other.
const RESERVE_LOCK_ID = 7340211;

/**
 * Reserves a seat for a guest and gives them their ticket code. Safe to call twice (it returns the
 * existing reservation) and safe under load: reservations are counted and written one at a time, so
 * the seat limit can never be exceeded.
 */
export async function reserveSeat(registrationId: string): Promise<ReserveResult> {
  return prisma.$transaction(async (tx): Promise<ReserveResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RESERVE_LOCK_ID})`;

    const registration = await tx.registration.findUnique({ where: { id: registrationId } });
    if (!registration) return { ok: false, reason: "NOT_FOUND" };
    if (registration.reservedAt && registration.ticketCode) {
      return { ok: true, registration, alreadyReserved: true };
    }

    const capacityRow = await tx.setting.findUnique({ where: { key: "seat_capacity" } });
    const capacity = parseCapacity(capacityRow ? capacityRow.value : DEFAULT_SETTINGS.seat_capacity);
    if (capacity !== null) {
      const taken = await tx.registration.count({ where: { reservedAt: { not: null } } });
      if (taken >= capacity) return { ok: false, reason: "FULL" };
    }

    let code = generateTicketCode();
    for (let i = 0; i < 8 && (await tx.registration.findUnique({ where: { ticketCode: code }, select: { id: true } })); i++) {
      code = generateTicketCode();
    }

    const updated = await tx.registration.update({
      where: { id: registrationId },
      data: { reservedAt: new Date(), ticketCode: code },
    });
    return { ok: true, registration: updated, alreadyReserved: false };
  });
}

export type ReleaseResult = { ok: true; registration: Registration } | { ok: false; reason: "NOT_FOUND" | "CHECKED_IN" };

/**
 * Cancels a reservation (the seat is free again). The ticket code is cleared too, so a ticket that was
 * already emailed stops being valid; a new reservation gets a new code. Guests who are already checked in stay as they are.
 */
export async function releaseReservation(registrationId: string): Promise<ReleaseResult> {
  const registration = await prisma.registration.findUnique({ where: { id: registrationId } });
  if (!registration) return { ok: false, reason: "NOT_FOUND" };
  if (registration.checkedInAt) return { ok: false, reason: "CHECKED_IN" };
  const updated = await prisma.registration.update({
    where: { id: registrationId },
    data: { reservedAt: null, ticketCode: null, ticketSentAt: null },
  });
  return { ok: true, registration: updated };
}
