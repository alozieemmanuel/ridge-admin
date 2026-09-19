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
            select: { id: true, fullName: true, email: true },
          },
        },
      },
    },
  });

  return NextResponse.json({ tables });
}
