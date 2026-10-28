import { NextRequest, NextResponse } from "next/server";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import { cleanBands, getTestConfig, saveTestConfig, type TestConfig } from "@/lib/tests";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "tests" });
  if (!ctx.ok) return ctx.response;
  const [config, active, checkedIn] = await Promise.all([
    getTestConfig(ctx.event.id),
    prisma.testQuestion.count({ where: { eventId: ctx.event.id, active: true } }),
    prisma.registration.count({ where: { eventId: ctx.event.id, checkedInAt: { not: null } } }),
  ]);
  return NextResponse.json({ config, activeQuestions: active, checkedIn, slug: ctx.event.slug });
}

export async function PUT(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "tests" });
  if (!ctx.ok) return ctx.response;
  const b = await request.json().catch(() => ({}));
  const patch: Partial<TestConfig> = {};
  if (typeof b.open === "boolean") {
    if (b.open) {
      const [cfg, active] = await Promise.all([getTestConfig(ctx.event.id), prisma.testQuestion.count({ where: { eventId: ctx.event.id, active: true } })]);
      const need = typeof b.count === "number" ? b.count : cfg.count;
      if (active < need) return NextResponse.json({ error: `Add at least ${need} active questions before opening the test (there are ${active}).` }, { status: 400 });
    }
    patch.open = b.open;
  }
  if (b.count !== undefined) {
    const n = Math.round(Number(b.count));
    if (!Number.isFinite(n) || n < 1 || n > 200) return NextResponse.json({ error: "Questions per test must be between 1 and 200." }, { status: 400 });
    patch.count = n;
  }
  if (b.minutes !== undefined) {
    const n = Math.round(Number(b.minutes));
    if (!Number.isFinite(n) || n < 1 || n > 600) return NextResponse.json({ error: "Time must be between 1 and 600 minutes." }, { status: 400 });
    patch.minutes = n;
  }
  if (typeof b.showAnswers === "boolean") patch.showAnswers = b.showAnswers;
  if (typeof b.intro === "string") patch.intro = b.intro.trim().slice(0, 600);
  if (Array.isArray(b.bands)) patch.bands = cleanBands(b.bands);
  await saveTestConfig(ctx.event.id, patch);
  await logAdminAction(ctx.session, { action: "test.settings", entityType: "test", details: patch as never }, request);
  return NextResponse.json({ ok: true });
}
