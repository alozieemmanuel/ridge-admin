import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { registrationSchema } from "@/lib/validation";
import { sendRegistrationEmails } from "@/lib/notifications";
import { jsonWithCors, preflight } from "@/lib/cors";

export const runtime = "nodejs";

export async function OPTIONS(request: NextRequest) {
  return preflight(request);
}

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonWithCors(request, { error: "Invalid JSON body." }, 400);
  }

  const parsed = registrationSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonWithCors(
      request,
      { error: "Validation failed.", details: parsed.error.flatten().fieldErrors },
      400
    );
  }

  const data = parsed.data;
  const regType = data.regType === "late" ? "LATE" : "EARLY_BIRD";
  const normalizedEmail = data.email.toLowerCase();

  // Upsert on email: prevents duplicate rows if someone double-submits or
  // resubmits after updating their details.
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
  // logged but never blocks the registration itself from succeeding.
  try {
    await sendRegistrationEmails(registration);
  } catch (err) {
    console.error("[registrations] Failed to send confirmation/notification emails:", err);
  }

  return jsonWithCors(request, { result: "success" });
}