import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { seatReleaseSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  const tables = await prisma.eventTable.findMany({
    orderBy: { order: "asc" },
    include: {
      seats: {
        orderBy: { seatNumber: "asc" },
        include: {
          registration: {
            select: { id: true, fullName: true, email: true, checkedInAt: true },
          },
        },
      },
    },
  });

  const online = await prisma.registration.findMany({
    where: { attendanceMode: "ONLINE" },
    orderBy: { attendanceChosenAt: "desc" },
    select: { id: true, fullName: true, email: true, attendanceChosenAt: true },
  });

  return NextResponse.json({ tables, online });
}

/**
 * Unveils or hides seats on the public seat page. Guests only ever see unveiled seats.
 *   unveil_next  releases the next `count` OPEN seats in table order (A1, A2, ... B1, ...)
 *   unveil_all   releases every OPEN seat
 *   hide_open    hides every OPEN seat that is currently unveiled (booked seats stay visible)
 */
export async function POST(request: NextRequest) {
  const session = await getSession();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = seatReleaseSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request." }, { status: 400 });
  }
  const { action, count } = parsed.data;

  let affected = 0;
  if (action === "unveil_next") {
    if (!count) return NextResponse.json({ error: "Enter how many seats to unveil." }, { status: 400 });
    const next = await prisma.seat.findMany({
      where: { status: "OPEN", released: false },
      orderBy: [{ table: { order: "asc" } }, { seatNumber: "asc" }],
      take: count,
      select: { id: true },
    });
    if (next.length > 0) {
      const res = await prisma.seat.updateMany({ where: { id: { in: next.map((s) => s.id) } }, data: { released: true } });
      affected = res.count;
    }
  } else if (action === "unveil_all") {
    affected = (await prisma.seat.updateMany({ where: { status: "OPEN", released: false }, data: { released: true } })).count;
  } else {
    affected = (await prisma.seat.updateMany({ where: { status: "OPEN", released: true }, data: { released: false } })).count;
  }

  await logAdminAction(
    session,
    {
      action: "seat.update",
      entityType: "seat",
      entityLabel: action === "hide_open" ? "Hid open seats" : "Unveiled seats",
      details: { action, requested: count ?? null, affected },
    },
    request
  );

  return NextResponse.json({ result: "success", affected });
}
