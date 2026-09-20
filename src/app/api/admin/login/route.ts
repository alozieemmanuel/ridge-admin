import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validation";
import { verifyPassword, createSessionToken, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const { email, password } = parsed.data;

  // Generic error message on every failure path below (unknown email, archived
  // account, wrong password) so the endpoint doesn't reveal which admin emails
  // exist or which accounts are archived.
  const genericError = NextResponse.json({ error: "Invalid email or password." }, { status: 401 });

  const admin = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
  if (!admin || admin.archivedAt) return genericError;

  const valid = await verifyPassword(password, admin.passwordHash);
  if (!valid) return genericError;

  const token = await createSessionToken({
    adminId: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });
  await setSessionCookie(token);

  await prisma.admin.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  return NextResponse.json({
    result: "success",
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  });
}