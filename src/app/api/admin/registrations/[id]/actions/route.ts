import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registrationActionSchema } from "@/lib/validation";
import {
  resendRegistrationConfirmation,
  sendSeatSelectionInvite,
  sendPaymentReminder,
} from "@/lib/notifications";

export const runtime = "nodejs";

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
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const registration = await prisma.registration.findUnique({ where: { id } });
  if (!registration) {
    return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  }

  try {
    switch (parsed.data.action) {
      case "resend_confirmation":
        await resendRegistrationConfirmation(registration);
        break;
      case "send_seat_invite":
        await sendSeatSelectionInvite(registration);
        break;
      case "send_payment_reminder":
        await sendPaymentReminder(registration);
        break;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email." },
      { status: 502 }
    );
  }

  return NextResponse.json({ result: "success" });
}
