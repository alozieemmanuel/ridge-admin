import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkSeatAccess } from "@/lib/seat-access";
import { sendOnlineConfirmation } from "@/lib/notifications";

export const runtime = "nodejs";

/** Records that the person will attend Day 7 online, and releases any seat they held. */
export async function POST(request: NextRequest) {
  let body: { t?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const access = await checkSeatAccess(String(body.t || ""));
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { registration } = access;

  if (registration.attendanceMode === "ONLINE" && !registration.seat) {
    return NextResponse.json({ result: "success", unchanged: true });
  }

  await prisma.$transaction(async (tx) => {
    if (registration.seat) {
      await tx.seat.update({ where: { id: registration.seat.id }, data: { status: "OPEN", registrationId: null } });
    }
    await tx.registration.update({
      where: { id: registration.id },
      data: { attendanceMode: "ONLINE", attendanceChosenAt: new Date() },
    });
  });

  let emailSent = true;
  try {
    const fresh = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    await sendOnlineConfirmation(fresh);
  } catch (err) {
    emailSent = false;
    console.error("[seats] Online confirmation email failed:", err);
  }

  return NextResponse.json({ result: "success", emailSent });
}
