import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

/** Permanently deletes one brochure request and its email history (owner only). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an owner can delete records." }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.brochureRequest.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Brochure request not found." }, { status: 404 });
  }

  await prisma.brochureRequest.delete({ where: { id } });
  return NextResponse.json({ result: "success" });
}
