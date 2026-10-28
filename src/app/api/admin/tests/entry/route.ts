import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import { getEntryConfig, saveEntryConfig, type EntryConfig } from "@/lib/entryQuiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Entry quiz settings, the question count, and everyone's score so far. */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "tests" });
  if (!ctx.ok) return ctx.response;
  const [config, available, rows] = await Promise.all([
    getEntryConfig(ctx.event.id),
    prisma.testQuestion.count({ where: { eventId: ctx.event.id, kind: "ENTRY", active: true } }),
    prisma.registration.findMany({
      where: { eventId: ctx.event.id, quizAttempts: { gt: 0 } },
      orderBy: { quizAt: "desc" },
      select: { id: true, fullName: true, email: true, quizScore: true, quizTotal: true, quizAt: true, quizAttempts: true, reservedAt: true },
    }),
  ]);
  return NextResponse.json({
    config,
    available,
    scores: rows.map((r) => ({ id: r.id, name: r.fullName, email: r.email, score: r.quizScore, total: r.quizTotal, attempts: r.quizAttempts, at: r.quizAt?.toISOString() ?? null, reserved: Boolean(r.reservedAt) })),
  });
}

export async function PUT(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "tests" });
  if (!ctx.ok) return ctx.response;
  const b = await request.json().catch(() => ({}));
  const patch: Partial<EntryConfig> = {};
  const cur = await getEntryConfig(ctx.event.id);
  const count = b.count !== undefined ? Math.round(Number(b.count)) : cur.count;
  if (!Number.isFinite(count) || count < 1 || count > 50) return NextResponse.json({ error: "Questions must be between 1 and 50." }, { status: 400 });
  patch.count = count;
  if (b.attempts !== undefined) {
    const a = Math.round(Number(b.attempts));
    if (!Number.isFinite(a) || a < 1 || a > 20) return NextResponse.json({ error: "Tries must be between 1 and 20." }, { status: 400 });
    patch.attempts = a;
  }
  if (b.pass !== undefined) {
    const p = Math.round(Number(b.pass));
    if (!Number.isFinite(p) || p < 0 || p > 100) return NextResponse.json({ error: "Pass mark must be between 0 and 100." }, { status: 400 });
    patch.pass = p;
  }
  if (typeof b.on === "boolean") {
    if (b.on) {
      const available = await prisma.testQuestion.count({ where: { eventId: ctx.event.id, kind: "ENTRY", active: true } });
      if (available < count) return NextResponse.json({ error: `Add at least ${count} active entry questions first (there are ${available}).` }, { status: 400 });
    }
    patch.on = b.on;
  }
  await saveEntryConfig(ctx.event.id, patch);
  await logAdminAction(ctx.session, { action: "test.settings", entityType: "test", details: { entryQuiz: patch } as never }, request);
  return NextResponse.json({ ok: true });
}

/** Gives one guest their tries back. Body: { id }. */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "tests" });
  if (!ctx.ok) return ctx.response;
  const b = await request.json().catch(() => ({}));
  const reg = await prisma.registration.findFirst({ where: { id: String(b.id || ""), eventId: ctx.event.id }, select: { id: true, fullName: true } });
  if (!reg) return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  await prisma.registration.update({ where: { id: reg.id }, data: { quizPaper: Prisma.DbNull, quizAt: null, quizScore: null, quizTotal: null, quizAttempts: 0 } });
  await logAdminAction(ctx.session, { action: "test.reset", entityType: "registration", entityId: reg.id, entityLabel: reg.fullName, details: { entryQuiz: true } }, request);
  return NextResponse.json({ ok: true });
}
