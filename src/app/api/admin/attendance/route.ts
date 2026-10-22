import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { getCapacity } from "@/lib/reservations";

export const runtime = "nodejs";

/** Attendance numbers and the people who reserved (for check-in). Optional ?code= finds one ticket for the QR-scan flow. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")?.trim().toUpperCase() || "";

  const [capacity, invited, people, scanned] = await Promise.all([
    getCapacity(),
    prisma.registration.count({ where: { OR: [{ inviteSentAt: { not: null } }, { reservedAt: { not: null } }] } }),
    prisma.registration.findMany({
      where: { reservedAt: { not: null } },
      orderBy: { reservedAt: "desc" },
      select: { id: true, fullName: true, email: true, phone: true, ticketCode: true, reservedAt: true, checkedInAt: true, ticketSentAt: true },
    }),
    code
      ? prisma.registration.findUnique({
          where: { ticketCode: code },
          select: { id: true, fullName: true, email: true, phone: true, ticketCode: true, reservedAt: true, checkedInAt: true, ticketSentAt: true },
        })
      : Promise.resolve(null),
  ]);

  const reserved = people.length;
  const checkedIn = people.filter((p) => p.checkedInAt).length;

  const shape = (r: NonNullable<typeof scanned>) => ({
    ...r,
    reservedAt: r.reservedAt?.toISOString() ?? null,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
    ticketSentAt: r.ticketSentAt?.toISOString() ?? null,
  });

  return NextResponse.json({
    capacity,
    invited,
    reserved,
    checkedIn,
    seatsLeft: capacity === null ? null : Math.max(0, capacity - reserved),
    people: people.map(shape),
    scanned: scanned ? shape(scanned) : null,
    scanNotFound: Boolean(code && !scanned),
  });
}

/** Sets how many seats there are. Body: { capacity: number | null } (null = no limit). */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  let raw: { capacity?: unknown };
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const c = raw.capacity;
  if (c !== null && (typeof c !== "number" || !Number.isInteger(c) || c < 1 || c > 100000)) {
    return NextResponse.json({ error: "Enter a whole number of seats, 1 or more." }, { status: 400 });
  }
  const reserved = await prisma.registration.count({ where: { reservedAt: { not: null } } });
  if (typeof c === "number" && c < reserved) {
    return NextResponse.json({ error: `${reserved} seats are already reserved, so the limit can't be lower than that.` }, { status: 409 });
  }
  const value = c === null ? "" : String(c);
  await prisma.setting.upsert({ where: { key: "seat_capacity" }, update: { value }, create: { key: "seat_capacity", value } });
  await logAdminAction(session, { action: "attendance.capacity", entityType: "data", details: { capacity: c } }, request);
  return NextResponse.json({ result: "success", capacity: c });
}
