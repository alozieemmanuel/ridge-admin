import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { confirmPaymentSchema } from "@/lib/validation";
import { getSettingsMap } from "@/lib/settings";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { sendPaymentConfirmation } from "@/lib/notifications";

export const runtime = "nodejs";

/**
 * Confirms a payment for a registration. The admin only supplies the amount
 * actually received — this derives NOT_PAID / PARTIAL / PAID by comparing it
 * against the registration's expected fee (from Settings, based on regType)
 * and stamps paymentUpdatedAt with the confirmation time.
 *
 * It can also approve the receipts the participant uploaded and email them a
 * payment confirmation, both only when the admin asks for it.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = confirmPaymentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid payload." },
      { status: 400 }
    );
  }

  const existing = await prisma.registration.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  }

  const settings = await getSettingsMap();
  const expectedFeeRaw = parseFloat(
    existing.regType === "LATE" ? settings.late_registration_fee_amount : settings.registration_fee_amount
  );
  const expectedFee = Number.isFinite(expectedFeeRaw) ? expectedFeeRaw : null;

  const { amountPaid } = parsed.data;
  const paymentStatus =
    amountPaid <= 0 ? "NOT_PAID" : expectedFee !== null && amountPaid >= expectedFee ? "PAID" : "PARTIAL";

  const registration = await prisma.registration.update({
    where: { id },
    data: {
      amountPaid,
      paymentStatus,
      paymentNote: parsed.data.note !== undefined ? parsed.data.note || null : undefined,
      paymentUpdatedAt: new Date(),
    },
  });

  // Receipts the admin approved with this payment.
  const approveIds = parsed.data.approveProofIds ?? [];
  if (approveIds.length > 0) {
    await prisma.paymentProof.updateMany({
      where: { id: { in: approveIds }, registrationId: id, status: "PENDING" },
      data: { status: "APPROVED", reviewedAt: new Date(), reviewedByName: session?.name ?? null },
    });
  }

  // The participant is only emailed about their payment once an admin has approved it here.
  let emailError: string | null = null;
  const wantsEmail = parsed.data.sendConfirmation === true;
  if (wantsEmail) {
    try {
      await sendPaymentConfirmation(registration);
    } catch (err) {
      emailError = err instanceof Error ? err.message : "Failed to send the confirmation email.";
    }
  }

  await logAdminAction(
    session,
    {
      action: "registration.payment_update",
      entityType: "registration",
      entityId: id,
      entityLabel: existing.fullName,
      details: {
        before: { amountPaid: existing.amountPaid, status: existing.paymentStatus },
        after: { amountPaid, status: paymentStatus },
        expectedFee,
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
        ...(approveIds.length ? { approvedReceipts: approveIds.length } : {}),
        ...(wantsEmail ? { confirmationEmail: emailError ? `failed: ${emailError.slice(0, 200)}` : "sent" } : {}),
      },
    },
    request
  );

  return NextResponse.json({
    result: "success",
    registration,
    expectedFee,
    emailSent: wantsEmail && !emailError,
    emailError,
  });
}

/**
 * Permanently deletes one registration (owner only). Its email history goes
 * with it, and any seat it held is released back to OPEN.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an owner can delete records." }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.registration.findUnique({
    where: { id },
    select: { id: true, fullName: true, email: true, paymentStatus: true, amountPaid: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.seat.updateMany({
      where: { registrationId: id },
      data: { status: "OPEN", registrationId: null, holdExpiresAt: null },
    }),
    prisma.registration.delete({ where: { id } }),
  ]);

  await logAdminAction(
    session,
    {
      action: "registration.delete",
      entityType: "registration",
      entityId: id,
      entityLabel: existing.fullName,
      details: { email: existing.email, paymentStatus: existing.paymentStatus, amountPaid: existing.amountPaid },
    },
    request
  );

  return NextResponse.json({ result: "success" });
}