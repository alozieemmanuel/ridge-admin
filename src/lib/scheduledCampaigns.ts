import { prisma } from "@/lib/prisma";
import { mailchimpConfigured } from "@/lib/mailchimp";
import { CampaignSendError, executeMailchimpCampaign, prepareMailchimpCampaign, sendNormalCampaign, summarize, type CampaignInput } from "@/lib/campaignRun";

/**
 * Campaigns set to go out at a chosen time. A timer (see README) calls runDueCampaigns every few minutes. Each due campaign is
 * claimed first, so two timers can never send it twice, then sent exactly the way the Send button sends it.
 * A campaign that is cut off half way is marked FAILED rather than retried, because a retry could email people twice.
 */

export interface ScheduledItem {
  id: string;
  subject: string;
  audience: string;
  category: string | null;
  runAt: string;
  status: string;
  resultMessage: string | null;
  createdByName: string | null;
  finishedAt: string | null;
}

const STALE_RUNNING_MS = 12 * 60_000;

export async function runDueCampaigns(opts: { eventId?: string; budgetMs?: number } = {}): Promise<{ ran: number; results: string[] }> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 200_000;
  const now = new Date();
  const results: string[] = [];

  // A run that stopped without reporting (the server was cut off) is not repeated: some guests may already have the email.
  await prisma.scheduledCampaign.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) }, ...(opts.eventId ? { eventId: opts.eventId } : {}) },
    data: { status: "FAILED", finishedAt: now, resultMessage: "The send was interrupted. Open Sent campaigns to see who already got it, then schedule the rest again." },
  });

  const due = await prisma.scheduledCampaign.findMany({
    where: { status: "PENDING", runAt: { lte: now }, ...(opts.eventId ? { eventId: opts.eventId } : {}) },
    orderBy: { runAt: "asc" },
    take: 20,
  });

  let ran = 0;
  for (const job of due) {
    if (Date.now() - started > budget) break;
    const claim = await prisma.scheduledCampaign.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "RUNNING", startedAt: new Date() } });
    if (claim.count !== 1) continue; // another timer took it
    ran++;
    try {
      const event = await prisma.event.findUnique({ where: { id: job.eventId } });
      if (!event) throw new CampaignSendError("The event no longer exists.");
      const input: CampaignInput = { audience: job.audience, category: job.category, subject: job.subject, body: job.body, ctaLabel: job.ctaLabel };
      const by = job.createdByName ? `${job.createdByName} (scheduled)` : "Scheduled";
      const summary = mailchimpConfigured()
        ? await executeMailchimpCampaign(await prepareMailchimpCampaign(event, by, input))
        : await sendNormalCampaign(event, by, input);
      await prisma.scheduledCampaign.update({ where: { id: job.id }, data: { status: "DONE", finishedAt: new Date(), campaignId: summary.campaign.id, resultMessage: summarize(summary) } });
      results.push(`${job.subject}: sent`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.scheduledCampaign.update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: new Date(), resultMessage: message.slice(0, 500) } });
      results.push(`${job.subject}: failed (${message.slice(0, 120)})`);
    }
  }
  return { ran, results };
}
