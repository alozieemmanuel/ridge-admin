import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import { cleanQuestion, parseBulk } from "@/lib/testQuestions";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "tests" });
  if (!ctx.ok) return ctx.response;
  const kind = request.nextUrl.searchParams.get("kind") === "ENTRY" ? "ENTRY" : "TEST";
  const rows = await prisma.testQuestion.findMany({ where: { eventId: ctx.event.id, kind }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ questions: rows.map((q) => ({ id: q.id, text: q.text, options: q.options as string[], correctIndex: q.correctIndex, active: q.active })) });
}

/** Body: one question { text, options, correctIndex } or { bulk: "pasted text" }. */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "tests" });
  if (!ctx.ok) return ctx.response;
  const body = await request.json().catch(() => ({}));
  if (typeof body.bulk === "string") {
    const { questions, errors } = parseBulk(body.bulk);
    if (errors.length) return NextResponse.json({ error: errors.slice(0, 5).join(" ") + (errors.length > 5 ? ` (and ${errors.length - 5} more)` : "") }, { status: 400 });
    if (!questions.length) return NextResponse.json({ error: "No questions found in that text." }, { status: 400 });
    await prisma.testQuestion.createMany({ data: questions.map((q) => ({ eventId: ctx.event.id, kind: body.kind === "ENTRY" ? "ENTRY" : "TEST", text: q.text, options: q.options, correctIndex: q.correctIndex })) });
    await logAdminAction(ctx.session, { action: "test.question", entityType: "test", details: { imported: questions.length } }, request);
    return NextResponse.json({ ok: true, added: questions.length });
  }
  const c = cleanQuestion(body);
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: 400 });
  const row = await prisma.testQuestion.create({ data: { eventId: ctx.event.id, kind: body.kind === "ENTRY" ? "ENTRY" : "TEST", ...c } });
  await logAdminAction(ctx.session, { action: "test.question", entityType: "test", entityId: row.id, entityLabel: c.text.slice(0, 80), details: { added: true } }, request);
  return NextResponse.json({ ok: true, id: row.id });
}
