import { prisma } from "@/lib/prisma";
import { getSettingsMap } from "@/lib/settings";
import { sendCampaignEmail } from "@/lib/notifications";

/** Puts campaign emails that could not go out today in the queue. */
export async function queueCampaignEmails(campaignId: string, registrationIds: string[]): Promise<void> {
  if (!registrationIds.length) return;
  await prisma.queuedEmail.createMany({ data: registrationIds.map((registrationId) => ({ campaignId, registrationId })) });
}

export interface DrainResult {
  sent: number;
  failed: number;
  /** Still waiting (the senders ran out again, or the run hit its size limit). */
  waiting: number;
}

/**
 * Sends queued campaign emails, oldest first, until the queue is empty or every sender has used its limit again.
 * An email that fails three times is marked Failed. `max` keeps one run inside the function time limit.
 */
export async function drainEmailQueue(opts: { max?: number; campaignId?: string } = {}): Promise<DrainResult> {
  const max = opts.max ?? 400;
  const items = await prisma.queuedEmail.findMany({
    where: { status: "PENDING", ...(opts.campaignId ? { campaignId: opts.campaignId } : {}) },
    orderBy: { createdAt: "asc" },
    take: max,
    include: { campaign: true, registration: true },
  });

  const settingsByEvent = new Map<string, Record<string, string>>();
  let sent = 0;
  let failed = 0;
  let outOfSenders = false;

  const CONCURRENCY = 5;
  for (let i = 0; i < items.length && !outOfSenders; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (q) => {
        if (outOfSenders) return;
        let settings = settingsByEvent.get(q.campaign.eventId);
        if (!settings) {
          settings = await getSettingsMap(q.campaign.eventId);
          settingsByEvent.set(q.campaign.eventId, settings);
        }
        const result = await sendCampaignEmail(q.registration, q.campaign.subject, q.campaign.body, settings, q.campaignId, q.campaign.ctaLabel);
        if (result.deferred) {
          outOfSenders = true;
          return;
        }
        if (result.success) {
          sent++;
          await prisma.$transaction([
            prisma.queuedEmail.update({ where: { id: q.id }, data: { status: "SENT", attempts: { increment: 1 }, doneAt: new Date(), lastError: null } }),
            prisma.campaign.update({ where: { id: q.campaignId }, data: { sentCount: { increment: 1 } } }),
          ]);
        } else if (q.attempts + 1 >= 3) {
          failed++;
          await prisma.$transaction([
            prisma.queuedEmail.update({ where: { id: q.id }, data: { status: "FAILED", attempts: { increment: 1 }, doneAt: new Date(), lastError: result.error?.slice(0, 300) } }),
            prisma.campaign.update({ where: { id: q.campaignId }, data: { failedCount: { increment: 1 } } }),
          ]);
        } else {
          await prisma.queuedEmail.update({ where: { id: q.id }, data: { attempts: { increment: 1 }, lastError: result.error?.slice(0, 300) } });
        }
      })
    );
  }

  const waiting = await prisma.queuedEmail.count({ where: { status: "PENDING", ...(opts.campaignId ? { campaignId: opts.campaignId } : {}) } });
  return { sent, failed, waiting };
}
