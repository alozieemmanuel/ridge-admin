import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { convertProspectSchema } from "@/lib/validation";
import { sendRegistrationEmails } from "@/lib/notifications";

export const runtime = "nodejs";

/**
 * Turns a prospect into a registration (same upsert-by-email behavior as the
 * public registration form) and links the two. The confirmation email is only
 * sent if the admin ticks the box.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = convertProspectSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payload." }, { status: 400 });
  }

  const prospect = await prisma.prospect.findUnique({ where: { id } });
  if (!prospect) return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  if (prospect.registrationId) {
    return NextResponse.json({ error: "This prospect has already been converted." }, { status: 409 });
  }

  const data = parsed.data;
  const email = data.email.toLowerCase();
  const regType = data.regType === "late" ? "LATE" : "EARLY_BIRD";

  // A registration can only be linked to one prospect.
  const alreadyLinked = await prisma.prospect.findFirst({ where: { registration: { email } } });
  if (alreadyLinked) {
    return NextResponse.json(
      { error: `${email} is already registered and linked to another prospect (${alreadyLinked.fullName}).` },
      { status: 409 }
    );
  }

  const registration = await prisma.registration.upsert({
    where: { email },
    update: {
      fullName: prospect.fullName,
      phone: data.phone,
      country: data.country,
      organization: data.organization || null,
      notes: data.notes || null,
      regType,
    },
    create: {
      fullName: prospect.fullName,
      email,
      phone: data.phone,
      country: data.country,
      organization: data.organization || null,
      notes: data.notes || null,
      regType,
    },
  });

  await prisma.prospect.update({
    where: { id },
    data: {
      registrationId: registration.id,
      // Keep the contact details we now know, so the WhatsApp/Prospects views stay in step.
      email: prospect.email ?? email,
      phone: prospect.phone ?? data.phone,
    },
  });

  let emailError: string | null = null;
  if (data.sendConfirmation) {
    try {
      await sendRegistrationEmails(registration);
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err);
      console.error("[prospects] Confirmation email failed after conversion:", err);
    }
  }

  await logAdminAction(
    session,
    {
      action: "prospect.convert",
      entityType: "prospect",
      entityId: id,
      entityLabel: prospect.fullName,
      details: { registrationId: registration.id, sendConfirmation: data.sendConfirmation },
    },
    request
  );

  return NextResponse.json({ result: "success", registrationId: registration.id, emailError });
}
