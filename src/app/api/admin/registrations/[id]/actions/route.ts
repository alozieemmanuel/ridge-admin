import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registrationActionSchema } from "@/lib/validation";
import {
  resendRegistrationConfirmation,
  sendSeatSelectionInvite,
  sendPaymentReminder,
} from "@/lib/notifications";

export const runtime = "nodejs";

/**
 * Admin email actions for a single registration:
 *   resend_confirmation   — the registration confirmation email
 *   send_seat_invite      — the "pick your seat" email (only once fully paid)
 *   send_payment_reminder — a reminder (only while not fully paid)
 *
 * On a send failure this returns 502 with the provider's reason in `error`,
 * which the dashboard shows next to the button.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = registrationActionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const registration = await prisma.registration.findUnique({ where: { id } });
  if (!registration) {
    return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  }

  const { action } = parsed.data;

  // The seat-invite email says "your payment has been confirmed", and a
  // reminder for someone who has paid in full would be wrong — so guard both.
  if (action === "send_seat_invite" && registration.paymentStatus !== "PAID") {
    return NextResponse.json(
      { error: "Payment isn't marked as fully paid yet. Update the payment first, then send the seat invite." },
      { status: 409 }
    );
  }
  if (action === "send_payment_reminder" && registration.paymentStatus === "PAID") {
    return NextResponse.json({ error: "This registration is already fully paid." }, { status: 409 });
  }

  try {
    if (action === "resend_confirmation") await resendRegistrationConfirmation(registration);
    else if (action === "send_seat_invite") await sendSeatSelectionInvite(registration);
    else await sendPaymentReminder(registration);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email." },
      { status: 502 }
    );
  }

  return NextResponse.json({ result: "success" });
}
