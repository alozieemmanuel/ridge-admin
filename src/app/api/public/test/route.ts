import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildPaper, finishAttempt, getTestConfig, normaliseCode, rewardFor, type PaperQuestion } from "@/lib/tests";
import { termsOf } from "@/lib/eventTheme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The guest's test portal. One endpoint, one "action" in the body:
 *   status  looks at the ticket code and says what the guest may do
 *   start   draws this guest's own paper (once) and returns it
 *   answer  saves one answer
 *   submit  finishes and grades
 * The ticket code is the only credential, and every call checks it again together with the check-in.
 * The correct answers are only ever sent after the test is finished (and only if the event allows it).
 */
const err = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

async function load(slug: string, codeRaw: unknown) {
  const event = await prisma.event.findUnique({
    where: { slug: String(slug || "").toLowerCase() },
    select: { id: true, name: true, status: true, modules: true, brandName: true, color: true, logoUrl: true, logoDarkUrl: true, terms: true },
  });
  if (!event || event.status === "DRAFT" || !event.modules.includes("tests")) return { fail: err("This test is not available.", 404) };
  const code = normaliseCode(codeRaw);
  const brand = { name: event.brandName || event.name, color: event.color, logoUrl: event.logoUrl, logoDarkUrl: event.logoDarkUrl };
  if (!code) return { fail: err("Enter your ticket code.", 400, { brand }) };
  const reg = await prisma.registration.findFirst({
    where: { eventId: event.id, ticketCode: code },
    select: { id: true, fullName: true, checkedInAt: true, ticketCode: true },
  });
  if (!reg) return { fail: err("We could not find that ticket code. Check it and try again.", 404, { code: "NOT_FOUND" }) };
  return { event, reg, brand, config: await getTestConfig(event.id) };
}

function firstName(n: string) {
  return n.trim().split(/\s+/)[0] || n;
}

/** The paper as the guest sees it: no correct answers. */
function publicPaper(paper: PaperQuestion[]) {
  return paper.map((q) => ({ qid: q.qid, text: q.text, options: q.options }));
}

function resultView(a: NonNullable<Awaited<ReturnType<typeof finishAttempt>>>, config: Awaited<ReturnType<typeof getTestConfig>>) {
  const paper = a.paper as unknown as PaperQuestion[];
  const answers = (a.answers ?? {}) as Record<string, number>;
  return {
    score: a.score ?? 0,
    total: a.total || paper.length,
    reward: rewardFor(a.score ?? 0, a.total || paper.length, config.bands),
    review: config.showAnswers ? paper.map((q) => ({ text: q.text, options: q.options, correct: q.correct, chosen: Number.isInteger(answers[q.qid]) ? answers[q.qid] : null })) : null,
  };
}

export async function POST(request: NextRequest) {
  let body: { action?: string; slug?: string; code?: string; qid?: string; choice?: number };
  try {
    body = await request.json();
  } catch {
    return err("Bad request.");
  }
  const ctx = await load(body.slug || "", body.code);
  if ("fail" in ctx && ctx.fail) return ctx.fail;
  const { event, reg, brand, config } = ctx as Exclude<typeof ctx, { fail: NextResponse }>;
  const head = { brand, terms: termsOf(event.terms), eventName: event.name, name: firstName(reg.fullName) };

  let attempt = await prisma.testAttempt.findUnique({ where: { registrationId: reg.id } });
  // A test that ran out of time is marked at the next call.
  if (attempt && !attempt.submittedAt && attempt.deadline.getTime() <= Date.now()) attempt = await finishAttempt(attempt.id);

  if (attempt?.submittedAt) {
    return NextResponse.json({ ...head, state: "done", result: resultView(attempt, config) });
  }

  // Not finished: everything below needs the guest to be present.
  if (!reg.checkedInAt) {
    return NextResponse.json({ ...head, state: "not_checked_in" });
  }

  const action = body.action || "status";

  if (attempt) {
    const paper = attempt.paper as unknown as PaperQuestion[];
    if (action === "answer") {
      const q = paper.find((p) => p.qid === body.qid);
      const choice = Number(body.choice);
      if (!q || !Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return err("That answer is not valid.");
      const answers = { ...((attempt.answers ?? {}) as Record<string, number>), [q.qid]: choice };
      await prisma.testAttempt.update({ where: { id: attempt.id }, data: { answers } });
      return NextResponse.json({ ok: true });
    }
    if (action === "submit") {
      const done = await finishAttempt(attempt.id);
      return NextResponse.json({ ...head, state: "done", result: resultView(done!, config) });
    }
    return NextResponse.json({
      ...head,
      state: "running",
      deadline: attempt.deadline.toISOString(),
      serverNow: new Date().toISOString(),
      paper: publicPaper(paper),
      answers: attempt.answers ?? {},
    });
  }

  // No attempt yet.
  if (!config.open) return NextResponse.json({ ...head, state: "closed" });
  if (action !== "start") return NextResponse.json({ ...head, state: "ready", minutes: config.minutes, count: config.count, intro: config.intro });

  const questions = await prisma.testQuestion.findMany({ where: { eventId: event.id, active: true } });
  if (questions.length < config.count) return err("The test is not ready yet. Please tell the team.", 409, { code: "NOT_READY" });
  const paper = buildPaper(questions, config.count);
  const deadline = new Date(Date.now() + config.minutes * 60_000);
  try {
    await prisma.testAttempt.create({ data: { eventId: event.id, registrationId: reg.id, deadline, paper: paper as unknown as object, total: paper.length } });
  } catch {
    // Two taps at once: the other one won. Show that paper.
  }
  const made = await prisma.testAttempt.findUnique({ where: { registrationId: reg.id } });
  if (!made) return err("Could not start the test. Please try again.", 500);
  return NextResponse.json({
    ...head,
    state: "running",
    deadline: made.deadline.toISOString(),
    serverNow: new Date().toISOString(),
    paper: publicPaper(made.paper as unknown as PaperQuestion[]),
    answers: {},
  });
}
