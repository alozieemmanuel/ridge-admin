import { prisma } from "@/lib/prisma";
import { verifySeatToken } from "@/lib/proof-token";

export type SeatAccess =
  | { ok: true; registration: NonNullable<Awaited<ReturnType<typeof loadRegistration>>> }
  | { ok: false; status: number; error: string };

function loadRegistration(id: string) {
  return prisma.registration.findUnique({ where: { id }, include: { seat: { include: { table: true } } } });
}

/**
 * Checks that a seat-page token is genuine and that this person may choose:
 * payment must be confirmed in full, and they must not have been checked in
 * at the venue already.
 */
export async function checkSeatAccess(token: string): Promise<SeatAccess> {
  const id = verifySeatToken(token);
  if (!id) {
    return { ok: false, status: 400, error: "This link isn't valid. Please use the link in your most recent email, or contact the RIDGE team." };
  }
  const registration = await loadRegistration(id);
  if (!registration) return { ok: false, status: 404, error: "We couldn't find your registration. Please contact the RIDGE team." };
  if (registration.paymentStatus !== "PAID") {
    return { ok: false, status: 403, error: "Your payment hasn't been fully confirmed yet, so seat selection isn't open for you. Once it is confirmed we'll email you." };
  }
  if (registration.checkedInAt) {
    return { ok: false, status: 409, error: "You've already checked in, so your seat can't be changed online. Please speak to the team at the venue." };
  }
  return { ok: true, registration };
}
