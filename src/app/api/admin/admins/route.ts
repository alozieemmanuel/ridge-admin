import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminSchema } from "@/lib/validation";
import { hashPassword, getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const admins = await prisma.admin.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, createdAt: true, lastLoginAt: true },
  });
  return NextResponse.json({ admins });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an owner can add admins." }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = createAdminSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { name, email, password, role } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const existing = await prisma.admin.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return NextResponse.json({ error: "An admin with that email already exists." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const admin = await prisma.admin.create({
    data: { name, email: normalizedEmail, passwordHash, role },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return NextResponse.json({ result: "success", admin }, { status: 201 });
}
