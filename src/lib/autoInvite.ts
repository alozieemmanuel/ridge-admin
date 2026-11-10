import { prisma } from "@/lib/prisma";
import { getSettingsMap } from "@/lib/settings";
import { missingEventDetails, sendInvitation } from "@/lib/notifications";
import { AUTO_INVITE_KEY, AUTO_INVITE_LAST_KEY, AUTO_INVITE_NEW_PREFIX, AUTO_INVITE_SINCE_KEY } from "@/lib/autoInviteKeys";

/**
 * Automatic invitation: when it is switched on for an event, everyone who is added by a live source AFTER the switch was turned
 * on (live sheet, Supabase table, website form) is emailed the "reserve your seat" invitation, once, without anyone pressing a button.
 * People who were already on the list are left to the manual "Invite everyone not yet invited" button, so switching it on never
 * emails a whole old list by surprise.
 *
 * Safe to run from several places at once (every sheet sync, the timer): each person waits as one row in the settings table, and a run
 * deletes the row before sending, so two runs can never send the same invitation twice. If the send fails the row is put back, and a
 * person whose invitation failed 3 times is left alone (the address is probably wrong) until someone fixes it.
 */

export interface AutoInviteLast {
  at: string;
  sent: number;
  failed: number;
  waiting: number;
  note?: string;
}

const MAX_TRIES = 3;
const CONCURRENCY = 4;

async function read(eventId: string, key: string): Promise<string | null> {
  return (await prisma.setting.findUnique({ where: { eventId_key: { eventId, key } } }))?.value ?? null;
}
async function write(eventId: string, key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { eventId_key: { eventId, key } }, update: { value }, create: { eventId, key, value } });
}

export async function getAutoInvite(eventId: string): Promise<{ on: boolean; since: string | null; last: AutoInviteLast | null }> {
  const [on, since, last] = await Promise.all([read(eventId, AUTO_INVITE_KEY), read(eventId, AUTO_INVITE_SINCE_KEY), read(eventId, AUTO_INVITE_LAST_KEY)]);
  let parsed: AutoInviteLast | null = null;
  if (last) {
    try {
      parsed = JSON.parse(last) as AutoInviteLast;
    } catch {
      parsed = null;
    }
  }
  return { on: on === "1", since: since && since !== "0" ? since : null, last: parsed };
}

/** Switching on starts from this moment. Switching off keeps the moment, so nothing is lost; switching on again starts a fresh moment. */
export async function setAutoInvite(eventId: string, on: boolean): Promise<void> {
  if (on) await write(eventId, AUTO_INVITE_SINCE_KEY, new Date().toISOString());
  await write(eventId, AUTO_INVITE_KEY, on ? "1" : "0");
}

export interface AutoInviteResult {
  sent: number;
  failed: number;
  waiting: number;
  skipped?: string;
}

/**
 * Called right after people were added by a live source (sheet, Supabase, website form). Puts the new people, and only them, in the
 * waiting list for the automatic invitation. A CSV import or "Add a contact" never calls this, so nobody is emailed by surprise.
 * createdSince: the moment the read began, so everyone created by this read (and nobody older) is picked up.
 */
export async function queueNewForInvite(eventId: string, createdSince: Date): Promise<number> {
  const state = await getAutoInvite(eventId);
  if (!state.on || !state.since) return 0;
  const from = new Date(Math.max(createdSince.getTime(), new Date(state.since).getTime()));
  const fresh = await prisma.registration.findMany({
    where: { eventId, email: { not: "" }, inviteSentAt: null, reservedAt: null, createdAt: { gte: from } },
    select: { id: true },
    take: 5000,
  });
  if (fresh.length === 0) return 0;
  const res = await prisma.setting.createMany({ data: fresh.map((r: { id: string }) => ({ eventId, key: `${AUTO_INVITE_NEW_PREFIX}${r.id}`, value: "1" })), skipDuplicates: true });
  return res.count;
}

/** Sends the invitation to everyone in the waiting list, a few at a time, within a time budget. */
export async function runAutoInvite(eventId: string, opts: { budgetMs?: number; max?: number } = {}): Promise<AutoInviteResult> {
  const state = await getAutoInvite(eventId);
  if (!state.on) return { sent: 0, failed: 0, waiting: 0, skipped: "off" };

  const rows = await prisma.setting.findMany({ where: { eventId, key: { startsWith: AUTO_INVITE_NEW_PREFIX } }, select: { key: true }, take: opts.max ?? 300 });
  if (rows.length === 0) return { sent: 0, failed: 0, waiting: 0 };

  const settings = await getSettingsMap(eventId);
  const missing = missingEventDetails(settings);
  if (missing.length) {
    const note = `Not sent: fill in the ${missing.join(" and ")} in Settings.`;
    await write(eventId, AUTO_INVITE_LAST_KEY, JSON.stringify({ at: new Date().toISOString(), sent: 0, failed: 0, waiting: rows.length, note } satisfies AutoInviteLast));
    return { sent: 0, failed: 0, waiting: rows.length, skipped: note };
  }

  const started = Date.now();
  const budget = opts.budgetMs ?? 35_000;
  const idOf = (key: string) => key.slice(AUTO_INVITE_NEW_PREFIX.length);
  let sent = 0;
  let failed = 0;
  let next = 0;

  const worker = async () => {
    while (next < rows.length && Date.now() - started < budget) {
      const key = rows[next++].key;
      // Claim: only one run can delete a given row, so only one run sends this person's invitation.
      const claim = await prisma.setting.deleteMany({ where: { eventId, key } });
      if (claim.count !== 1) continue;
      const person = await prisma.registration.findFirst({ where: { id: idOf(key), eventId } });
      // Gone, no email, already invited or already reserved: nothing to send.
      if (!person || !person.email || person.inviteSentAt || person.reservedAt) continue;
      // An address that has already failed several times is left alone (probably wrong). Fixing it on the dashboard and using the button below sends it.
      if ((await prisma.emailEvent.count({ where: { type: "FAILED", kind: "invitation", registrationId: person.id } })) >= MAX_TRIES) continue;
      try {
        await sendInvitation(person, "invitation", settings);
        sent++;
      } catch (err) {
        failed++;
        console.error("[auto-invite] failed for", person.email, err instanceof Error ? err.message : err);
        // Put the person back for the next run. After MAX_TRIES failures the next run drops them (see above).
        await prisma.setting.createMany({ data: [{ eventId, key, value: "1" }], skipDuplicates: true });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));

  const waiting = await prisma.setting.count({ where: { eventId, key: { startsWith: AUTO_INVITE_NEW_PREFIX } } });
  if (sent || failed) {
    await write(eventId, AUTO_INVITE_LAST_KEY, JSON.stringify({ at: new Date().toISOString(), sent, failed, waiting } satisfies AutoInviteLast));
  }
  return { sent, failed, waiting };
}

/** Used right after a live read: queue the new people, then send. Never throws, so a problem here cannot break a sync. */
export async function inviteNewAfterSync(eventId: string, readStartedAt: Date): Promise<void> {
  try {
    if ((await queueNewForInvite(eventId, new Date(readStartedAt.getTime() - 5_000))) > 0) await runAutoInvite(eventId);
  } catch (err) {
    console.error("[auto-invite] after sync:", err instanceof Error ? err.message : err);
  }
}

/** For the timer: every event that has the switch on. Sends whatever is still waiting (a big batch, or a send that failed earlier). */
export async function runAllAutoInvites(budgetMs = 120_000): Promise<{ event: string; result: string }[]> {
  const rows = await prisma.setting.findMany({ where: { key: AUTO_INVITE_KEY, value: "1", event: { status: "ACTIVE" } }, select: { eventId: true, event: { select: { slug: true } } } });
  const started = Date.now();
  const out: { event: string; result: string }[] = [];
  for (const row of rows) {
    if (Date.now() - started > budgetMs) {
      out.push({ event: row.event.slug, result: "skipped: out of time, next run" });
      continue;
    }
    try {
      const r = await runAutoInvite(row.eventId, { budgetMs: Math.max(5_000, budgetMs - (Date.now() - started)) });
      out.push({ event: row.event.slug, result: `${r.sent} invited, ${r.failed} failed${r.waiting ? `, ${r.waiting} waiting` : ""}` });
    } catch (err) {
      out.push({ event: row.event.slug, result: `failed: ${err instanceof Error ? err.message : "unknown error"}` });
    }
  }
  return out;
}
