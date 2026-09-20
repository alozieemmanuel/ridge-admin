import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";

export const runtime = "nodejs";

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("edit"),
    name: z.string().trim().min(1, "Name can't be empty.").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email."),
    role: z.enum(["OWNER", "ADMIN"]),
  }),
  z.object({
    action: z.literal("password"),
    password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  }),
  z.object({ action: z.literal("archive") }),
  z.object({ action: z.literal("restore") }),
]);

/** True if `id` is the only active (not archived) owner, so removing/demoting them would lock everyone out. */
async function isLastActiveOwner(id: string): Promise<boolean> {
  const others = await prisma.admin.count({
    where: { role: "OWNER", archivedAt: null, id: { not: id } },
  });
  return others === 0;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an owner can manage admins." }, { status: 403 });
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request." }, { status: 400 });
  }

  const target = await prisma.admin.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "Admin not found." }, { status: 404 });
  }

  const data = parsed.data;

  if (data.action === "edit") {
    if (data.email !== target.email) {
      const clash = await prisma.admin.findUnique({ where: { email: data.email } });
      if (clash) return NextResponse.json({ error: "Another admin already uses that email." }, { status: 409 });
    }
    if (target.role === "OWNER" && data.role !== "OWNER" && (await isLastActiveOwner(id))) {
      return NextResponse.json({ error: "There must be at least one active owner." }, { status: 409 });
    }
    await prisma.admin.update({ where: { id }, data: { name: data.name, email: data.email, role: data.role } });
    await logAdminAction(
      session,
      {
        action: "admin.update",
        entityType: "admin",
        entityId: id,
        entityLabel: data.name,
        details: {
          before: { name: target.name, email: target.email, role: target.role },
          after: { name: data.name, email: data.email, role: data.role },
        },
      },
      request
    );
    return NextResponse.json({ result: "success" });
  }

  if (data.action === "password") {
    await prisma.admin.update({ where: { id }, data: { passwordHash: await hashPassword(data.password) } });
    await logAdminAction(
      session,
      { action: "admin.password_change", entityType: "admin", entityId: id, entityLabel: target.name, details: { email: target.email } },
      request
    );
    return NextResponse.json({ result: "success" });
  }

  if (data.action === "archive") {
    if (id === session.adminId) {
      return NextResponse.json({ error: "You can't archive your own account." }, { status: 409 });
    }
    if (target.role === "OWNER" && (await isLastActiveOwner(id))) {
      return NextResponse.json({ error: "You can't archive the last active owner." }, { status: 409 });
    }
    await prisma.admin.update({ where: { id }, data: { archivedAt: new Date() } });
    await logAdminAction(
      session,
      { action: "admin.archive", entityType: "admin", entityId: id, entityLabel: target.name, details: { email: target.email } },
      request
    );
    return NextResponse.json({ result: "success" });
  }

  // restore
  await prisma.admin.update({ where: { id }, data: { archivedAt: null } });
  await logAdminAction(
    session,
    { action: "admin.restore", entityType: "admin", entityId: id, entityLabel: target.name, details: { email: target.email } },
    request
  );
  return NextResponse.json({ result: "success" });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an owner can remove admins." }, { status: 403 });
  }

  const { id } = await params;

  if (id === session.adminId) {
    return NextResponse.json({ error: "You can't remove your own account." }, { status: 409 });
  }

  const target = await prisma.admin.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "Admin not found." }, { status: 404 });
  }
  if (target.role === "OWNER" && (await isLastActiveOwner(id))) {
    return NextResponse.json({ error: "You can't remove the last active owner." }, { status: 409 });
  }

  await prisma.admin.delete({ where: { id } });
  await logAdminAction(
    session,
    { action: "admin.delete", entityType: "admin", entityId: id, entityLabel: target.name, details: { email: target.email, role: target.role } },
    request
  );
  return NextResponse.json({ result: "success" });
}