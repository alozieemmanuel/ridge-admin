import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateSeatStatusSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ seatId: string }> }) {
  const { seatId } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = updateSeatStatusSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const existing = await prisma.seat.findUnique({ where: { id: seatId } });
  if (!existing) {
    return NextResponse.json({ error: "Seat not found." }, { status: 404 });
  }

  const { status } = parsed.data;
  // Manually setting a seat back to OPEN or BLOCKED clears any registration
  // link — a seat can't simultaneously be "available"/"disabled" and
  // "assigned to someone". RESERVED/TAKEN via this manual endpoint leave
  // the assignment as-is (the public booking flow is what actually assigns
  // a registrant to a seat; this endpoint is for admin corrections).
  const clearAssignment = status === "OPEN" || status === "BLOCKED";

  const seat = await prisma.seat.update({
    where: { id: seatId },
    data: {
      status,
      registrationId: clearAssignment ? null : existing.registrationId,
    },
    include: { registration: { select: { id: true, fullName: true, email: true } } },
  });

  return NextResponse.json({ result: "success", seat });
}
