import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Marks a registration as checked in (arrived on Day 7) or reverses that,
 * for the Seats → Attendance tab. Body: { checkedIn: boolean }.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const checkedIn = (raw as { checkedIn?: unknown })?.checkedIn;
  if (typeof checkedIn !== "boolean") {
    return NextResponse.json({ error: "checkedIn must be a boolean." }, { status: 400 });
  }

  const existing = await prisma.registration.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  }

  const registration = await prisma.registration.update({
    where: { id },
    data: { checkedInAt: checkedIn ? new Date() : null },
  });

  return NextResponse.json({
    result: "success",
    checkedInAt: registration.checkedInAt ? registration.checkedInAt.toISOString() : null,
  });
}
