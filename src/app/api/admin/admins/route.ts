import { NextRequest, NextResponse } from "next/server";
import { canManage, isPower } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { createAdminSchema } from "@/lib/validation";
import { hashPassword, getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Owners get the full list (roles, archived state, everything).
 * Other admins get names, emails and last login only, no roles and no
 * archived people, so they can see who else is on the team but nothing more.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const isOwner = isPower(session.role);

  const admins = await prisma.admin.findMany({
    where: isOwner ? {} : { archivedAt: null },
    orderBy: [{ archivedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      lastLoginAt: true,
      archivedAt: true,
      createdAt: true,
      events: { select: { eventId: true } },
    },
  });

  return NextResponse.json({
    isOwner,
    viewerRole: session.role,
    admins: admins.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      lastLoginAt: a.lastLoginAt ? a.lastLoginAt.toISOString() : null,
      // Only owners ever receive these two fields.
      ...(isOwner
        ? { role: a.role, archivedAt: a.archivedAt ? a.archivedAt.toISOString() : null, eventIds: a.events.map((e) => e.eventId) }
        : {}),
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !isPower(session.role)) {
    return NextResponse.json({ error: "Only an owner or super admin can add admins." }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = createAdminSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payload." }, { status: 400 });
  }

  const { name, email, password, role } = parsed.data;
  if (!canManage(session.role, role)) return NextResponse.json({ error: "Only an owner can add owners and super admins." }, { status: 403 });
  const eventIds = Array.isArray((raw as { eventIds?: unknown }).eventIds) ? ((raw as { eventIds: unknown[] }).eventIds.filter((x) => typeof x === "string") as string[]) : [];

  const existing = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    return NextResponse.json({ error: "An admin with that email already exists." }, { status: 409 });
  }

  const admin = await prisma.admin.create({
    data: {
      name,
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      role: role ?? "ADMIN",
      ...(eventIds.length ? { events: { create: eventIds.map((eventId) => ({ eventId })) } } : {}),
    },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  await logAdminAction(
    session,
    { action: "admin.create", entityType: "admin", entityId: admin.id, entityLabel: admin.name, details: { email: admin.email, role: admin.role } },
    request
  );

  return NextResponse.json({ result: "success", admin }, { status: 201 });
}