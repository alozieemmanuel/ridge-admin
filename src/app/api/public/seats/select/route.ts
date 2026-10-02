import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkSeatAccess } from "@/lib/seat-access";
import { sendSeatConfirmation } from "@/lib/notifications";

export const runtime = "nodejs";

class SeatTakenError extends Error {}

/**
 * Books a seat. The claim is a single guarded update (only if the seat is
 * still OPEN), inside a transaction that first releases the person's previous
 * seat, so two people can never end up with the same seat and a failed
 * change leaves them with the seat they had.
 */
export async function POST(request: NextRequest) {
  let body: { t?: unknown; seatId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const access = await checkSeatAccess(String(body.t || ""));
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { registration } = access;

  const seatId = String(body.seatId || "");
  if (!seatId) return NextResponse.json({ error: "Choose a seat first." }, { status: 400 });

  if (registration.seat?.id === seatId) {
    return NextResponse.json({ result: "success", seatLabel: registration.seat.label, unchanged: true });
  }

  let seat: { label: string; tableLabel: string };
  try {
    seat = await prisma.$transaction(async (tx) => {
      if (registration.seat) {
        await tx.seat.update({ where: { id: registration.seat.id }, data: { status: "OPEN", registrationId: null } });
      }
      const claimed = await tx.seat.updateMany({
        where: { id: seatId, status: "OPEN" },
        data: { status: "TAKEN", registrationId: registration.id, holdExpiresAt: null },
      });
      if (claimed.count !== 1) throw new SeatTakenError();
      await tx.registration.update({
        where: { id: registration.id },
        data: { attendanceMode: "IN_PERSON", attendanceChosenAt: new Date() },
      });
      const row = await tx.seat.findUniqueOrThrow({ where: { id: seatId }, include: { table: true } });
      return { label: row.label, tableLabel: row.table.label };
    });
  } catch (err) {
    if (err instanceof SeatTakenError) {
      return NextResponse.json({ error: "Sorry, that seat was just taken or isn't available. Please choose another.", code: "SEAT_TAKEN" }, { status: 409 });
    }
    console.error("[seats] Booking failed:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  // The seat is booked either way; a failed email is recorded on the registration and doesn't undo it.
  let emailSent = true;
  try {
    const fresh = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    await sendSeatConfirmation(fresh, seat);
  } catch (err) {
    emailSent = false;
    console.error("[seats] Seat confirmation email failed:", err);
  }

  return NextResponse.json({ result: "success", seatLabel: seat.label, emailSent });
}
