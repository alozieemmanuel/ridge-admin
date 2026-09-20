import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Resets a registration's payment back to "not paid": amount, note and the
 * payment-updated date are cleared. The registration, its seat and its email
 * history are left alone. The previous values are kept in the audit log.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  const existing = await prisma.registration.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  }

  const registration = await prisma.registration.update({
    where: { id },
    data: { amountPaid: 0, paymentStatus: "NOT_PAID", paymentNote: null, paymentUpdatedAt: null },
  });

  await logAdminAction(
    session,
    {
      action: "registration.payment_reset",
      entityType: "registration",
      entityId: id,
      entityLabel: existing.fullName,
      details: {
        before: { amountPaid: existing.amountPaid, status: existing.paymentStatus, note: existing.paymentNote },
        after: { amountPaid: 0, status: "NOT_PAID" },
      },
    },
    request
  );

  return NextResponse.json({ result: "success", registration });
}