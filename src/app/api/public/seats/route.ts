import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkSeatAccess } from "@/lib/seat-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The seat map for the public seat page: every table and seat with its
 * status, but no names or emails of who holds them. `mine` marks the caller's
 * own seat.
 */
export async function GET(request: NextRequest) {
  const access = await checkSeatAccess(request.nextUrl.searchParams.get("t") || "");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { registration } = access;

  const tables = await prisma.eventTable.findMany({
    orderBy: { order: "asc" },
    include: { seats: { orderBy: { seatNumber: "asc" }, select: { id: true, seatNumber: true, label: true, status: true, registrationId: true } } },
  });

  return NextResponse.json({
    guest: { firstName: registration.fullName.trim().split(/\s+/)[0] || "there" },
    current: {
      mode: registration.attendanceMode,
      seatLabel: registration.seat?.label ?? null,
    },
    tables: tables.map((t) => ({
      id: t.id,
      label: t.label,
      seats: t.seats.map((s) => ({
        id: s.id,
        seatNumber: s.seatNumber,
        label: s.label,
        status: s.status,
        mine: s.registrationId === registration.id,
      })),
    })),
  });
}
