import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";

export const runtime = "nodejs";

/** Deletes one person's attempt so they can take the test again (for example after a phone died). A new random paper is drawn. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEvent(request, { module: "tests" });
  if (!ctx.ok) return ctx.response;
  const { id } = await params;
  const a = await prisma.testAttempt.findFirst({ where: { id, eventId: ctx.event.id }, include: { registration: { select: { fullName: true } } } });
  if (!a) return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  await prisma.testAttempt.delete({ where: { id } });
  await logAdminAction(ctx.session, { action: "test.reset", entityType: "test", entityId: id, entityLabel: a.registration.fullName }, request);
  return NextResponse.json({ ok: true });
}
