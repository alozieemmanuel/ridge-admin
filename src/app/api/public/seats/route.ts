import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkSeatAccess } from "@/lib/seat-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The seat map for the public seat page: the unveiled tables and seats with
 * their status, but no names or emails of who holds them. `mine` marks the
 * caller's own seat.
 */
export async function GET(request: NextRequest) {
  const access = await checkSeatAccess(request.nextUrl.searchParams.get("t") || "");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { registration } = access;

  const tables = await prisma.eventTable.findMany({
    orderBy: { order: "asc" },
    include: { seats: { orderBy: { seatNumber: "asc" }, select: { id: true, seatNumber: true, label: true, status: true, registrationId: true, released: true } } },
  });

  // Guests only see tables that have unveiled seats. Inside such a table, seats that are not
  // unveiled yet show as "not available" (never as open) so the table keeps its shape.
  const canSee = (s: { released: boolean; registrationId: string | null }) => s.released || s.registrationId === registration.id;
  const visible = tables
    .filter((t) => t.seats.some(canSee))
    .map((t) => ({ ...t, seats: t.seats.map((s) => (canSee(s) ? s : { ...s, status: "BLOCKED" as const })) }));
  const availableCount = visible.reduce((n, t) => n + t.seats.filter((s) => s.status === "OPEN").length, 0);

  return NextResponse.json({
    guest: { firstName: registration.fullName.trim().split(/\s+/)[0] || "there" },
    current: {
      mode: registration.attendanceMode,
      seatLabel: registration.seat?.label ?? null,
    },
    availableCount,
    tables: visible.map((t) => ({
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
