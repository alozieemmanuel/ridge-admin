import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registrationSchema } from "@/lib/validation";
import { sendRegistrationEmails } from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = registrationSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const regType = data.regType === "late" ? "LATE" : "EARLY_BIRD";
  const normalizedEmail = data.email.toLowerCase();

  // Upsert on email: prevents duplicate rows if someone double-submits or
  // resubmits after updating their details, mirroring the duplicate-prevention
  // pattern already used elsewhere in your registration systems.
  const registration = await prisma.registration.upsert({
    where: { email: normalizedEmail },
    update: {
      fullName: data.fullName,
      phone: data.phone,
      country: data.country,
      organization: data.organization || null,
      notes: data.notes || null,
      regType,
    },
    create: {
      fullName: data.fullName,
      email: normalizedEmail,
      phone: data.phone,
      country: data.country,
      organization: data.organization || null,
      notes: data.notes || null,
      regType,
    },
  });

  // Email sending happens after the row is safely written. A failure here is
  // logged (see recordEvent/FAILED in notifications.ts) but never blocks the
  // registration itself from succeeding.
  try {
    await sendRegistrationEmails(registration);
  } catch (err) {
    console.error("[registrations] Failed to send confirmation/notification emails:", err);
  }

  return NextResponse.json({ result: "success" });
}
