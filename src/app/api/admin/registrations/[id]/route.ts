import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateRegistrationSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = updateRegistrationSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const existing = await prisma.registration.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  }

  const registration = await prisma.registration.update({
    where: { id },
    data: {
      paymentStatus: parsed.data.paymentStatus,
      paymentNote: parsed.data.paymentNote !== undefined ? parsed.data.paymentNote || null : undefined,
    },
  });

  return NextResponse.json({ result: "success", registration });
}
