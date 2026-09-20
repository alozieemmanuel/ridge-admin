import { NextRequest, NextResponse } from "next/server";
import type { Registration } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registrationActionSchema } from "@/lib/validation";
import { getSettingsMap } from "@/lib/settings";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import {
  resendRegistrationConfirmation,
  sendSeatSelectionInvite,
  sendPaymentReminder,
} from "@/lib/notifications";

export const runtime = "nodejs";

function money(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** "no payment recorded yet" / "USD 1,000 of USD 2,000 received", used in the not-fully-paid error. */
function describePayment(registration: Registration, settings: Record<string, string>): string {
  if (registration.paymentStatus === "NOT_PAID") return "no payment recorded yet";
  const currency = settings.currency || "USD";
  const fee = parseFloat(
    registration.regType === "LATE" ? settings.late_registration_fee_amount : settings.registration_fee_amount
  );
  return `${money(currency, registration.amountPaid)}${Number.isFinite(fee) ? ` of ${money(currency, fee)}` : ""} received`;
}

/**
 * Admin email actions for a single registration:
 *   resend_confirmation   — the registration confirmation email
 *   send_seat_invite      — the "pick your seat" email (only once fully paid)
 *   send_payment_reminder — a reminder (only while not fully paid)
 *
 * On a send failure this returns 502 with the provider's reason in `error`,
 * which the dashboard shows next to the button. Every attempt (sent, blocked
 * or failed) is written to the audit log.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = registrationActionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid action." }, { status: 400 });
  }

  const registration = await prisma.registration.findUnique({ where: { id } });
  if (!registration) {
    return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  }

  const { action } = parsed.data;
  const audit = (outcome: "sent" | "blocked" | "failed", extra?: Record<string, string>) =>
    logAdminAction(
      session,
      {
        action: `registration.${action}`,
        entityType: "registration",
        entityId: registration.id,
        entityLabel: registration.fullName,
        details: { outcome, to: registration.email, paymentStatus: registration.paymentStatus, ...extra },
      },
      request
    );

  // The seat-invite email says "your payment has been confirmed", and a
  // reminder for someone who has paid in full would be wrong, so guard both.
  if (action === "send_seat_invite" && registration.paymentStatus !== "PAID") {
    const settings = await getSettingsMap();
    const error = `${registration.fullName} hasn't finished making their payment (${describePayment(
      registration,
      settings
    )}). The seat-selection email can only be sent once they've paid in full.`;
    await audit("blocked", { reason: "payment not complete" });
    return NextResponse.json({ error }, { status: 409 });
  }
  if (action === "send_payment_reminder" && registration.paymentStatus === "PAID") {
    await audit("blocked", { reason: "already fully paid" });
    return NextResponse.json({ error: "This registration is already fully paid." }, { status: 409 });
  }

  try {
    if (action === "resend_confirmation") await resendRegistrationConfirmation(registration);
    else if (action === "send_seat_invite") await sendSeatSelectionInvite(registration);
    else await sendPaymentReminder(registration);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send email.";
    await audit("failed", { error: message.slice(0, 300) });
    return NextResponse.json({ error: message }, { status: 502 });
  }

  await audit("sent");
  return NextResponse.json({ result: "success" });
}