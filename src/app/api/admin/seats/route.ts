import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
