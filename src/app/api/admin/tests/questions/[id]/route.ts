import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import { cleanQuestion } from "@/lib/testQuestions";

export const runtime = "nodejs";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEvent(request, { module: "tests" });
  if (!ctx.ok) return ctx.response;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const existing = await prisma.testQuestion.findFirst({ where: { id, eventId: ctx.event.id } });
  if (!existing) return NextResponse.json({ error: "Question not found." }, { status: 404 });
  // Switching one question on or off only sends { active }.
  if (Object.keys(body).length === 1 && typeof body.active === "boolean") {
    await prisma.testQuestion.update({ where: { id }, data: { active: body.active } });
    return NextResponse.json({ ok: true });
  }
  const c = cleanQuestion(body);
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: 400 });
  await prisma.testQuestion.update({ where: { id }, data: c });
  await logAdminAction(ctx.session, { action: "test.question", entityType: "test", entityId: id, entityLabel: c.text.slice(0, 80), details: { edited: true } }, request);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEvent(request, { module: "tests" });
  if (!ctx.ok) return ctx.response;
  const { id } = await params;
  const existing = await prisma.testQuestion.findFirst({ where: { id, eventId: ctx.event.id } });
  if (!existing) return NextResponse.json({ error: "Question not found." }, { status: 404 });
  await prisma.testQuestion.delete({ where: { id } });
  await logAdminAction(ctx.session, { action: "test.question", entityType: "test", entityLabel: existing.text.slice(0, 80), details: { deleted: true } }, request);
  return NextResponse.json({ ok: true });
}
