import { prisma } from "@/lib/prisma";
import { sendViaBrevo, sendViaGmailChannel, sendViaMailerSend, type SendEmailInput, type SendEmailResult } from "@/lib/email";

/**
 * The email sender pool. The owner lists the services mail can go out through, in order of preference, each with a daily limit
 * (0 = no limit). Each email goes through the first sender that is switched on, set up and under its limit. If that sender
 * fails, the next one takes over. When every sender has used its limit, campaign emails wait in a queue and go out after the
 * count resets (midnight, Lagos time). Emails a guest is waiting for (tickets, confirmations) never wait: they ignore the limits.
 *
 * With no senders listed the old rule applies: campaigns through Brevo, everything else through Gmail.
 * The keys of each service stay in the server environment, never in the database.
 */

export const SENDER_KINDS = [
  { kind: "GMAIL", name: "Gmail / Google Workspace", env: ["GMAIL_USER", "GMAIL_APP_PASSWORD"], suggestedLimit: 1500, note: "Workspace accounts can send about 1,500 a day." },
  { kind: "BREVO", name: "Brevo", env: ["BREVO_API_KEY", "EMAIL_FROM"], suggestedLimit: 300, note: "The free plan sends 300 a day." },
  { kind: "MAILERSEND", name: "MailerSend", env: ["MAILERSEND_API_KEY", "MAILERSEND_FROM"], suggestedLimit: 0, note: "Enter the daily limit of your MailerSend plan." },
] as const;

export type SenderKind = (typeof SENDER_KINDS)[number]["kind"];
export const isSenderKind = (v: unknown): v is SenderKind => SENDER_KINDS.some((k) => k.kind === v);

/** Lagos is UTC+1 all year. The daily count starts at midnight there. */
const DAY_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfToday(now = Date.now()): Date {
  return new Date(Math.floor((now + DAY_OFFSET_MS) / DAY_MS) * DAY_MS - DAY_OFFSET_MS);
}
export function startOfTomorrow(now = Date.now()): Date {
  return new Date(startOfToday(now).getTime() + DAY_MS);
}

export function isConfigured(kind: SenderKind): boolean {
  const def = SENDER_KINDS.find((k) => k.kind === kind)!;
  if (kind === "BREVO") return Boolean(process.env.BREVO_API_KEY) && Boolean(process.env.EMAIL_FROM || process.env.GMAIL_USER);
  if (kind === "MAILERSEND") return Boolean(process.env.MAILERSEND_API_KEY) && Boolean(process.env.MAILERSEND_FROM || process.env.EMAIL_FROM);
  return def.env.every((name) => Boolean(process.env[name]));
}

// The sender list rarely changes, so each server instance remembers it for a short while (savePool clears it).
let poolMemo: { at: number; rows: Awaited<ReturnType<typeof readPool>> } | null = null;
const POOL_TTL_MS = 30_000;
async function readPool() {
  return prisma.emailSender.findMany({ orderBy: { position: "asc" } });
}
export async function getPool() {
  if (poolMemo && Date.now() - poolMemo.at < POOL_TTL_MS) return poolMemo.rows;
  const rows = await readPool();
  poolMemo = { at: Date.now(), rows };
  return rows;
}

/** What each service has sent since midnight. Failed attempts are not counted. */
export async function sentToday(): Promise<Record<string, number>> {
  const rows = await prisma.emailEvent.groupBy({
    by: ["provider"],
    where: { type: "SENT", audience: "ATTENDEE", occurredAt: { gte: startOfToday() }, provider: { not: null } },
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) if (r.provider) out[r.provider] = r._count._all;
  return out;
}

export interface SenderStatus {
  kind: SenderKind;
  name: string;
  label: string;
  position: number;
  enabled: boolean;
  configured: boolean;
  needs: string[];
  dailyLimit: number;
  used: number;
  /** null = no limit */
  remaining: number | null;
  state: "ready" | "full" | "off" | "not_configured";
  /** The latest problem this service reported today (for example a Brevo sender that is not verified). */
  lastError: string | null;
  lastErrorAt: string | null;
}

export async function poolStatus(): Promise<SenderStatus[]> {
  const [pool, used] = await Promise.all([getPool(), sentToday()]);
  return pool.map((row) => {
    const kind = row.kind as SenderKind;
    const def = SENDER_KINDS.find((k) => k.kind === kind);
    const configured = def ? isConfigured(kind) : false;
    const u = used[kind] ?? 0;
    const remaining = row.dailyLimit > 0 ? Math.max(0, row.dailyLimit - u) : null;
    const state: SenderStatus["state"] = !row.enabled ? "off" : !configured ? "not_configured" : remaining === 0 ? "full" : "ready";
    return {
      kind,
      name: def?.name ?? kind,
      label: row.label,
      position: row.position,
      enabled: row.enabled,
      configured,
      needs: def ? [...def.env] : [],
      dailyLimit: row.dailyLimit,
      used: u,
      remaining,
      state,
      lastError: row.lastErrorAt && row.lastErrorAt >= startOfToday() ? row.lastError : null,
      lastErrorAt: row.lastErrorAt && row.lastErrorAt >= startOfToday() ? row.lastErrorAt.toISOString() : null,
    };
  });
}

// ---- In-process memory, so a big send does not ask the database for the count on every email ----
let counts: { at: number; byKind: Record<string, number> } | null = null;
const cooling = new Map<string, { until: number; why: string }>();
const COUNT_TTL_MS = 20_000;
const COOLDOWN_MS = 60_000;
/** A daily quota, a limit or "too many" from the service itself: leave it alone until the count resets. */
const QUOTA = /quota|exceed|daily|limit|too many/i;
const lastRecorded = new Map<string, number>();

/** Keeps the service's latest problem, so the sender card can say why a "Ready" sender is not sending. Never blocks sending. */
function rememberProblem(kind: SenderKind, error: string): void {
  const last = lastRecorded.get(kind) ?? 0;
  if (Date.now() - last < 10_000) return;
  lastRecorded.set(kind, Date.now());
  const text = error.slice(0, 300);
  prisma.emailSender.updateMany({ where: { kind }, data: { lastError: text, lastErrorAt: new Date() } }).then(() => { poolMemo = null; }).catch(() => {});
}
function clearProblem(kind: SenderKind, row: { lastError?: string | null }): void {
  if (!row.lastError) return;
  row.lastError = null;
  prisma.emailSender.updateMany({ where: { kind }, data: { lastError: null, lastErrorAt: null } }).catch(() => {});
}

async function currentCounts(): Promise<Record<string, number>> {
  if (!counts || Date.now() - counts.at > COUNT_TTL_MS) counts = { at: Date.now(), byKind: await sentToday() };
  return counts.byKind;
}

/** Problems that mean "this sender is not working right now", as opposed to "this one address is bad". */
const SENDER_LEVEL = /auth|login|credential|quota|limit|exceed|rate|network|reach|timeout|timed out|econn|enotfound|not set|not configured|unauthor|forbidden|sender|activat|suspend|verif|disabled|blocked|api key|\b(401|403|429|5\d\d)\b/i;

async function sendVia(kind: SenderKind, input: SendEmailInput): Promise<SendEmailResult> {
  if (kind === "BREVO") return sendViaBrevo(input);
  if (kind === "MAILERSEND") return sendViaMailerSend(input);
  return sendViaGmailChannel(input);
}

/**
 * Sends one email through the pool. Returns null when no senders are listed (the caller then uses the old rule).
 * Returns { deferred: true } when the email is a campaign email and every sender has used its limit.
 */
export async function sendThroughPool(input: SendEmailInput): Promise<SendEmailResult | null> {
  const pool = (await getPool()).filter((p) => p.enabled && isSenderKind(p.kind));
  if (pool.length === 0) return null;

  const isCampaign = input.kind === "campaign";
  // Inline images (tickets) only work through Gmail.
  const candidates = input.attachments?.length ? pool.filter((p) => p.kind === "GMAIL") : pool;
  if (candidates.length === 0) return null;

  // Daily limits only apply to campaigns, so a single invitation or ticket does not wait for the count.
  const used = isCampaign ? await currentCounts() : {};
  const problems: string[] = [];
  let lastError = "";
  let waitable = false; // something that clears by itself: a daily limit, a pause after an error, a service that is down
  let tried = false;

  for (const row of candidates) {
    const kind = row.kind as SenderKind;
    const name = SENDER_KINDS.find((k) => k.kind === kind)?.name ?? kind;
    if (!isConfigured(kind)) {
      lastError ||= `${name} is not set up on the server.`;
      problems.push(`${name}: not set up`);
      continue;
    }
    // A pause only applies to campaign emails. A ticket or confirmation a guest is waiting for always tries every sender.
    const pause = isCampaign ? cooling.get(kind) : undefined;
    if (pause && pause.until > Date.now()) {
      waitable = true;
      problems.push(`${name}: paused (${pause.why})`);
      continue;
    }
    if (isCampaign && row.dailyLimit > 0 && (used[kind] ?? 0) >= row.dailyLimit) {
      waitable = true;
      problems.push(`${name}: daily limit reached`);
      continue;
    }
    tried = true;
    // Count the email before it is sent, so five sends at once cannot all slip under the limit.
    used[kind] = (used[kind] ?? 0) + 1;
    const res = await sendVia(kind, input);
    if (res.success) {
      clearProblem(kind, row);
      return res;
    }
    used[kind] = Math.max(0, (used[kind] ?? 1) - 1);
    lastError = res.error || `${name} could not send.`;
    problems.push(`${name}: ${lastError}`);
    if (SENDER_LEVEL.test(lastError)) {
      waitable = true;
      // A quota from the service itself lasts until the day's count resets. Anything else is paused for a minute.
      cooling.set(kind, { until: QUOTA.test(lastError) ? startOfTomorrow().getTime() : Date.now() + COOLDOWN_MS, why: lastError.slice(0, 120) });
    }
    rememberProblem(kind, lastError);
  }

  // A campaign email that no sender can take right now is kept for later with the reason, not counted as a failure.
  if (isCampaign && waitable) return { success: false, deferred: true, error: problems.join(" | ") || "No sender could send this email right now." };
  if (!tried && !lastError) return { success: false, error: "No sender is available right now. Check the sender list." };
  return { success: false, error: lastError || "No sender could send this email." };
}

/** Replaces the whole list. Order of the array is the order of preference. */
export async function savePool(items: { kind: SenderKind; label?: string; dailyLimit: number; enabled: boolean }[]): Promise<void> {
  const seen = new Set<string>();
  const clean = items.filter((i) => (seen.has(i.kind) ? false : (seen.add(i.kind), true)));
  await prisma.$transaction([
    prisma.emailSender.deleteMany({ where: { kind: { notIn: clean.map((c) => c.kind) } } }),
    ...clean.map((c, index) =>
      prisma.emailSender.upsert({
        where: { kind: c.kind },
        update: { position: index, dailyLimit: c.dailyLimit, enabled: c.enabled, label: c.label || SENDER_KINDS.find((k) => k.kind === c.kind)!.name },
        create: { kind: c.kind, position: index, dailyLimit: c.dailyLimit, enabled: c.enabled, label: c.label || SENDER_KINDS.find((k) => k.kind === c.kind)!.name },
      })
    ),
  ]);
  counts = null;
  poolMemo = null;
  cooling.clear();
}
