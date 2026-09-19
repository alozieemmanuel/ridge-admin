import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an owner can remove admins." }, { status: 403 });
  }

  const { id } = await params;

  if (id === session.adminId) {
    return NextResponse.json({ error: "You cannot remove your own account." }, { status: 400 });
  }

  const target = await prisma.admin.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "Admin not found." }, { status: 404 });
  }

  if (target.role === "OWNER") {
    const ownerCount = await prisma.admin.count({ where: { role: "OWNER" } });
    if (ownerCount <= 1) {
      return NextResponse.json({ error: "At least one owner must remain." }, { status: 400 });
    }
  }

  await prisma.admin.delete({ where: { id } });
  return NextResponse.json({ result: "success" });
}
