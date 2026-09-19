import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { confirmPaymentSchema } from "@/lib/validation";
import { getSettingsMap } from "@/lib/settings";

export const runtime = "nodejs";

/**
 * Confirms a payment for a registration. The admin only supplies the amount
 * actually received — this derives NOT_PAID / PARTIAL / PAID by comparing it
 * against the registration's expected fee (from Settings, based on regType)
 * and stamps paymentUpdatedAt with the confirmation time.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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

  return NextResponse.json({ result: "success", registration, expectedFee });
}
