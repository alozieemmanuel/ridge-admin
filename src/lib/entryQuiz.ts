import { prisma } from "@/lib/prisma";
import { getSettingsMap, saveSetting } from "@/lib/settings";
import { buildPaper, gradeAttempt, type PaperQuestion } from "@/lib/tests";

/** The short quiz a guest takes before they can reserve a seat (the "tests" module, kind ENTRY). */
export interface EntryConfig {
  on: boolean;
  count: number;
  pass: number; // percent needed to reserve (100 = every answer right); 0 = everyone who finishes may reserve
  attempts: number; // how many tries a guest gets
}

export async function getEntryConfig(eventId: string): Promise<EntryConfig> {
  const m = await getSettingsMap(eventId);
  const n = (v: string | undefined, d: number, lo: number, hi: number) => {
    const x = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d;
  };
  return { on: m.entry_quiz_on === "1", count: n(m.entry_quiz_count, 5, 1, 50), pass: n(m.entry_quiz_pass, 100, 0, 100), attempts: n(m.entry_quiz_attempts, 3, 1, 20) };
}

export async function saveEntryConfig(eventId: string, c: Partial<EntryConfig>): Promise<void> {
  const jobs: Promise<void>[] = [];
  if (c.on !== undefined) jobs.push(saveSetting(eventId, "entry_quiz_on", c.on ? "1" : "0"));
  if (c.count !== undefined) jobs.push(saveSetting(eventId, "entry_quiz_count", String(c.count)));
  if (c.attempts !== undefined) jobs.push(saveSetting(eventId, "entry_quiz_attempts", String(c.attempts)));
  if (c.pass !== undefined) jobs.push(saveSetting(eventId, "entry_quiz_pass", String(c.pass)));
  await Promise.all(jobs);
}

export interface QuizState {
  required: boolean; // the guest must still clear the quiz before reserving
  enabled: boolean;
  count: number;
  pass: number;
  attempts: number;
  attemptsLeft: number;
  locked: boolean; // all tries used without passing
  state: "todo" | "passed" | "failed";
  score: number | null;
  total: number | null;
}

/** Is the quiz switched on for this guest's event, and where is the guest with it. A quiz with too few questions never blocks anyone. */
export async function quizState(reg: { id: string; eventId: string; quizScore: number | null; quizTotal: number | null; quizAt: Date | null; quizAttempts: number }): Promise<QuizState> {
  const off: QuizState = { required: false, enabled: false, count: 0, pass: 0, attempts: 0, attemptsLeft: 0, locked: false, state: "todo", score: null, total: null };
  const event = await prisma.event.findUnique({ where: { id: reg.eventId }, select: { modules: true } });
  if (!event?.modules.includes("tests")) return off;
  const cfg = await getEntryConfig(reg.eventId);
  if (!cfg.on) return off;
  const available = await prisma.testQuestion.count({ where: { eventId: reg.eventId, kind: "ENTRY", active: true } });
  if (available < cfg.count) return off;
  const finished = reg.quizAt !== null && reg.quizScore !== null && reg.quizTotal;
  const passed = Boolean(finished) && (reg.quizTotal ? (reg.quizScore! / reg.quizTotal) * 100 >= cfg.pass : false);
  return {
    required: !passed,
    enabled: true,
    count: cfg.count,
    pass: cfg.pass,
    attempts: cfg.attempts,
    attemptsLeft: Math.max(0, cfg.attempts - reg.quizAttempts),
    locked: !passed && reg.quizAttempts >= cfg.attempts,
    state: !finished ? "todo" : passed ? "passed" : "failed",
    score: finished ? reg.quizScore : null,
    total: finished ? reg.quizTotal : null,
  };
}

/** Draws a fresh paper for the guest and keeps it (so a refresh shows the same questions). Returns it without the answers. */
export async function startQuiz(reg: { id: string; eventId: string; quizPaper: unknown; quizAt: Date | null }, count: number) {
  let paper = reg.quizPaper as PaperQuestion[] | null;
  if (!paper || reg.quizAt) {
    const questions = await prisma.testQuestion.findMany({ where: { eventId: reg.eventId, kind: "ENTRY", active: true } });
    paper = buildPaper(questions, count);
    await prisma.registration.update({ where: { id: reg.id }, data: { quizPaper: paper as unknown as object, quizAt: null, quizScore: null, quizTotal: null } });
  }
  return paper.map((q) => ({ qid: q.qid, text: q.text, options: q.options }));
}

export async function submitQuiz(reg: { id: string; quizPaper: unknown }, answers: Record<string, number>) {
  const paper = reg.quizPaper as PaperQuestion[] | null;
  if (!paper) return null;
  const clean: Record<string, number> = {};
  for (const q of paper) if (Number.isInteger(answers[q.qid]) && answers[q.qid] >= 0 && answers[q.qid] < q.options.length) clean[q.qid] = answers[q.qid];
  const score = gradeAttempt(paper, clean);
  await prisma.registration.update({ where: { id: reg.id }, data: { quizScore: score, quizTotal: paper.length, quizAt: new Date(), quizAttempts: { increment: 1 } } });
  return { score, total: paper.length };
}
