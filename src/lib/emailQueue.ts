import { prisma } from "@/lib/prisma";
import { getSettingsMap } from "@/lib/settings";
import { sendCampaignEmail } from "@/lib/notifications";

/**
 * Campaign emails are sent from a queue. Every recipient of a campaign gets one row, and a row only ever moves forward:
 * PENDING, then SENDING (a run has picked it up), then SENT or FAILED. A run can be cut off at any moment (the function
 * time limit, a closed page) and the next run carries on with the rows still PENDING. Nobody is emailed twice:
 *   - a row is claimed before it is sent, so two runs never take the same row;
 *   - before sending, we check whether this person already has a SENT record for this campaign (or an identical one);
 *   - a row left in SENDING by a run that was cut off is given back after a few minutes, and that same check covers it.
 */
const CLAIM_STALE_MS = 3 * 60_000;
const CONCURRENCY = 5;

/** Puts campaign emails in the queue. */
export async function queueCampaignEmails(campaignId: string, registrationIds: string[]): Promise<void> {
  for (let i = 0; i < registrationIds.length; i += 1000) {
    await prisma.queuedEmail.createMany({ data: registrationIds.slice(i, i + 1000).map((registrationId) => ({ campaignId, registrationId })) });
  }
}

/** The campaigns that are the same email as this one (same event, subject, message and button). */
export async function siblingCampaignIds(c: { id: string; eventId: string; subject: string; body: string; ctaLabel: string | null }): Promise<string[]> {
  const rows = await prisma.campaign.findMany({ where: { eventId: c.eventId, subject: c.subject, body: c.body, ctaLabel: c.ctaLabel }, select: { id: true } });
  return rows.map((r) => r.id);
}

export interface DrainResult {
  sent: number;
  failed: number;
  /** Not sent because the person already has this email. */
  skipped: number;
  /** Still to go (waiting or in the middle of being sent). */
  waiting: number;
  /** Why the run stopped early when no sender could send (every sender full, or a sender problem). */
  blocked: string | null;
}

/**
 * Sends queued campaign emails until the time budget is used, the queue is empty, or no sender can send.
 * `budgetMs` keeps one run inside the function time limit: the page (or the daily job) calls again for the rest.
 */
export async function drainEmailQueue(opts: { max?: number; campaignId?: string; budgetMs?: number } = {}): Promise<DrainResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 40_000;
  const max = opts.max ?? 1000;
  const scope = opts.campaignId ? { campaignId: opts.campaignId } : {};

  // Rows that a cut-off run left in SENDING are given back.
  await prisma.queuedEmail.updateMany({ where: { status: "SENDING", claimedAt: { lt: new Date(Date.now() - CLAIM_STALE_MS) }, ...scope }, data: { status: "PENDING", claimedAt: null } });

  const settingsByEvent = new Map<string, Record<string, string>>();
  const siblingsByCampaign = new Map<string, string[]>();
  const seen = new Set<string>(); // rows already handled in this run (a failed one is not picked up again straight away)
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let blocked: string | null = null;
  let handled = 0;

  while (!blocked && handled < max && Date.now() - started < budget) {
    const rows = await prisma.queuedEmail.findMany({
      where: { status: "PENDING", ...scope, ...(seen.size ? { id: { notIn: [...seen] } } : {}) },
      // Rows a sender could not take go to the back (claimedAt is set), so a few stuck rows never hold up everyone behind them.
      orderBy: [{ claimedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }, { id: "asc" }],
      take: CONCURRENCY,
      include: { campaign: true, registration: true },
    });
    if (!rows.length) break;

    // Claim each row. If another run took it first, it is not ours.
    const mine: typeof rows = [];
    for (const q of rows) {
      seen.add(q.id);
      const claim = await prisma.queuedEmail.updateMany({ where: { id: q.id, status: "PENDING" }, data: { status: "SENDING", claimedAt: new Date() } });
      if (claim.count === 1) mine.push(q);
    }
    if (!mine.length) continue;
    handled += mine.length;

    // Who already has this email? (This campaign, or an identical one sent earlier.)
    const siblingIds = new Set<string>();
    for (const q of mine) {
      let ids = siblingsByCampaign.get(q.campaignId);
      if (!ids) {
        ids = await siblingCampaignIds(q.campaign);
        siblingsByCampaign.set(q.campaignId, ids);
      }
      ids.forEach((id) => siblingIds.add(id));
    }
    const already = await prisma.emailEvent.findMany({
      where: { type: "SENT", campaignId: { in: [...siblingIds] }, registrationId: { in: mine.map((q) => q.registrationId) } },
      select: { registrationId: true },
    });
    const have = new Set(already.map((a) => a.registrationId));

    const outcomes = await Promise.all(
      mine.map(async (q) => {
        if (have.has(q.registrationId)) return { q, kind: "skip" as const };
        if (!q.registration.email?.trim()) return { q, kind: "fail" as const, error: "This contact has no email address." };
        let settings = settingsByEvent.get(q.campaign.eventId);
        if (!settings) {
          settings = await getSettingsMap(q.campaign.eventId);
          settingsByEvent.set(q.campaign.eventId, settings);
        }
        const result = await sendCampaignEmail(q.registration, q.campaign.subject, q.campaign.body, settings, q.campaignId, q.campaign.ctaLabel);
        if (result.success) return { q, kind: "sent" as const };
        if (result.deferred) return { q, kind: "held" as const, error: result.error || "No sender could send right now." };
        return { q, kind: "fail" as const, error: result.error || "The email could not be sent." };
      })
    );

    // If anything in this group went out, the senders work: a "held" row then has a problem of its own (its address), not the senders.
    const workedHere = outcomes.some((o) => o.kind === "sent");
    for (const o of outcomes) {
      const q = o.q;
      const failure = o.kind === "fail" || (o.kind === "held" && workedHere);
      const error = o.kind === "fail" || o.kind === "held" ? o.error : undefined;
      if (o.kind === "sent") {
        sent++;
        await prisma.$transaction([
          prisma.queuedEmail.update({ where: { id: q.id }, data: { status: "SENT", attempts: { increment: 1 }, doneAt: new Date(), lastError: null } }),
          prisma.campaign.update({ where: { id: q.campaignId }, data: { sentCount: { increment: 1 } } }),
        ]);
      } else if (o.kind === "skip") {
        skipped++;
        await prisma.queuedEmail.update({ where: { id: q.id }, data: { status: "SENT", doneAt: new Date(), lastError: "Already received this email." } });
      } else if (failure) {
        if (q.attempts + 1 >= 3) {
          failed++;
          await prisma.$transaction([
            prisma.queuedEmail.update({ where: { id: q.id }, data: { status: "FAILED", attempts: { increment: 1 }, doneAt: new Date(), lastError: error?.slice(0, 300) } }),
            prisma.campaign.update({ where: { id: q.campaignId }, data: { failedCount: { increment: 1 } } }),
          ]);
        } else {
          await prisma.queuedEmail.update({ where: { id: q.id }, data: { status: "PENDING", claimedAt: null, attempts: { increment: 1 }, lastError: error?.slice(0, 300) } });
        }
      } else {
        // No sender can take it right now. Nothing was tried against this person, so give the row back untouched and stop.
        blocked = o.kind === "held" ? o.error : blocked;
        await prisma.queuedEmail.update({ where: { id: q.id }, data: { status: "PENDING", claimedAt: new Date(), lastError: error?.slice(0, 300) } });
      }
    }
  }

  const waiting = await prisma.queuedEmail.count({ where: { status: { in: ["PENDING", "SENDING"] }, ...scope } });
  return { sent, failed, skipped, waiting, blocked };
}
