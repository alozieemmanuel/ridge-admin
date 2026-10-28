import { randomInt } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSettingsMap, saveSetting } from "@/lib/settings";

/** Settings of one event's test, kept in the Setting table (keys start with "test_"). */
export interface TestConfig {
  open: boolean;
  count: number;
  minutes: number;
  showAnswers: boolean;
  intro: string;
  bands: { min: number; label: string }[]; // min = percentage; highest match wins
}

export const TEST_DEFAULTS: TestConfig = { open: false, count: 20, minutes: 20, showAnswers: true, intro: "", bands: [] };

export async function getTestConfig(eventId: string): Promise<TestConfig> {
  const m = await getSettingsMap(eventId);
  let bands: TestConfig["bands"] = [];
  try {
    const parsed = JSON.parse(m.test_bands || "[]");
    if (Array.isArray(parsed)) bands = cleanBands(parsed);
  } catch {
    bands = [];
  }
  const num = (v: string | undefined, d: number, lo: number, hi: number) => {
    const n = Number(v);
    return Number.isFinite(n) && v !== undefined && v !== "" ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
  };
  return {
    open: m.test_open === "1",
    count: num(m.test_count, TEST_DEFAULTS.count, 1, 200),
    minutes: num(m.test_minutes, TEST_DEFAULTS.minutes, 1, 600),
    showAnswers: m.test_show_answers !== "0",
    intro: m.test_intro || "",
    bands,
  };
}

export function cleanBands(input: unknown[]): TestConfig["bands"] {
  return input
    .map((b) => b as { min?: unknown; label?: unknown })
    .map((b) => ({ min: Math.min(100, Math.max(0, Math.round(Number(b.min)))), label: String(b.label ?? "").trim().slice(0, 120) }))
    .filter((b) => Number.isFinite(b.min) && b.label)
    .sort((a, b) => b.min - a.min)
    .slice(0, 12);
}

export async function saveTestConfig(eventId: string, c: Partial<TestConfig>): Promise<void> {
  const jobs: Promise<void>[] = [];
  if (c.open !== undefined) jobs.push(saveSetting(eventId, "test_open", c.open ? "1" : "0"));
  if (c.count !== undefined) jobs.push(saveSetting(eventId, "test_count", String(c.count)));
  if (c.minutes !== undefined) jobs.push(saveSetting(eventId, "test_minutes", String(c.minutes)));
  if (c.showAnswers !== undefined) jobs.push(saveSetting(eventId, "test_show_answers", c.showAnswers ? "1" : "0"));
  if (c.intro !== undefined) jobs.push(saveSetting(eventId, "test_intro", c.intro));
  if (c.bands !== undefined) jobs.push(saveSetting(eventId, "test_bands", JSON.stringify(c.bands)));
  await Promise.all(jobs);
}

/** Fisher-Yates with a cryptographic random source. Returns a new array. */
export function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface PaperQuestion {
  qid: string;
  text: string;
  options: string[];
  correct: number;
}

/** Draws `count` of the active questions at random, shuffles their order, and shuffles each question's options. */
export function buildPaper(questions: { id: string; text: string; options: unknown; correctIndex: number }[], count: number): PaperQuestion[] {
  return shuffle(questions)
    .slice(0, count)
    .map((q) => {
      const opts = (q.options as string[]).map((text, i) => ({ text, right: i === q.correctIndex }));
      const mixed = shuffle(opts);
      return { qid: q.id, text: q.text, options: mixed.map((o) => o.text), correct: mixed.findIndex((o) => o.right) };
    });
}

export function gradeAttempt(paper: PaperQuestion[], answers: Record<string, number>): number {
  return paper.reduce((n, q) => n + (answers[q.qid] === q.correct ? 1 : 0), 0);
}

export function rewardFor(score: number, total: number, bands: TestConfig["bands"]): string | null {
  if (!total) return null;
  const pct = (score / total) * 100;
  return bands.find((b) => pct >= b.min)?.label ?? null;
}

/** Marks an attempt as finished (once). Safe to call again: a submitted attempt is left as it is. */
export async function finishAttempt(attemptId: string, answers?: Record<string, number>) {
  const a = await prisma.testAttempt.findUnique({ where: { id: attemptId } });
  if (!a || a.submittedAt) return a;
  const paper = a.paper as unknown as PaperQuestion[];
  const final = answers ?? (a.answers as Record<string, number>);
  const score = gradeAttempt(paper, final);
  const now = new Date();
  const res = await prisma.testAttempt.updateMany({
    where: { id: attemptId, submittedAt: null },
    data: { submittedAt: now < a.deadline ? now : a.deadline, answers: final, score, total: paper.length },
  });
  void res;
  return prisma.testAttempt.findUnique({ where: { id: attemptId } });
}

export const normaliseCode = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
