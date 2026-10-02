import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettingsMap } from "@/lib/settings";
import { verifyProofToken } from "@/lib/proof-token";
import { jsonWithCors, preflight } from "@/lib/cors";

export const runtime = "nodejs";

export async function OPTIONS(request: NextRequest) {
  return preflight(request);
}

/**
 * Lets the public payment page pick up where a person left off when they
 * arrive from a payment reminder email (register page with ?pay=<token>).
 * Returns only what the page needs: first name, registration type (so the
 * right fee is shown), and how much is still outstanding in USD.
 */
export async function POST(request: NextRequest) {
  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonWithCors(request, { error: "Invalid request." }, 400);
  }

  const registrationId = verifyProofToken(String(body.token || ""));
  if (!registrationId) {
    return jsonWithCors(
      request,
      { error: "This payment link isn't valid. Please use the link in your most recent email, or message the RIDGE team." },
      400
    );
  }

  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { fullName: true, regType: true, paymentStatus: true, amountPaid: true },
  });
  if (!registration) {
    return jsonWithCors(request, { error: "We couldn't find your registration. Please message the RIDGE team." }, 404);
  }

  const settings = await getSettingsMap();
  const feeRaw = parseFloat(registration.regType === "LATE" ? settings.late_registration_fee_amount : settings.registration_fee_amount);
  const fee = Number.isFinite(feeRaw) ? feeRaw : null;
  const balanceUsd = fee !== null ? Math.max(0, fee - registration.amountPaid) : null;

  return jsonWithCors(request, {
    firstName: registration.fullName.trim().split(/\s+/)[0] || "there",
    regType: registration.regType === "LATE" ? "late" : "early_bird",
    paymentStatus: registration.paymentStatus,
    amountPaidUsd: registration.amountPaid,
    balanceUsd,
  });
}
