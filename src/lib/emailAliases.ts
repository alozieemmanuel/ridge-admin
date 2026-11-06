import { prisma } from "@/lib/prisma";
import type { ImportedPerson } from "@/lib/csvImport";

/**
 * Corrections made on the dashboard, remembered per event as "old address -> corrected address".
 *
 * Why: the live sheet (and a CSV that is loaded again, or a website form) is only READ by the dashboard. Fixing a typo
 * here does not change the sheet, so the next sync would find the old address in the sheet, see nobody with that
 * address, and add the guest a second time. With the correction remembered, the old address in the sheet is read as the
 * corrected one, so the sync updates the same contact instead of creating a duplicate.
 *
 * One setting row per correction (key "email_alias:<old address>"), so several corrections saved at the same moment
 * (for example "Apply all suggested fixes") can never overwrite each other.
 */

export const ALIAS_PREFIX = "email_alias:";

export function isAliasKey(key: string): boolean {
  return key.startsWith(ALIAS_PREFIX);
}

const norm = (e: string) => e.trim().toLowerCase();

/** Remembers that `from` was corrected to `to`. Does nothing when either is empty or they are the same. */
export async function recordEmailAlias(eventId: string, from: string, to: string): Promise<void> {
  const a = norm(from);
  const b = norm(to);
  if (!a || !b || a === b) return;
  // The corrected address is the real one now, so it is no longer an old address.
  await prisma.setting.deleteMany({ where: { eventId, key: `${ALIAS_PREFIX}${b}` } });
  // Corrections that pointed at the address just corrected again now point at the final one (A -> B and then B -> C makes A -> C).
  await prisma.setting.updateMany({ where: { eventId, key: { startsWith: ALIAS_PREFIX }, value: a }, data: { value: b } });
  await prisma.setting.upsert({
    where: { eventId_key: { eventId, key: `${ALIAS_PREFIX}${a}` } },
    update: { value: b },
    create: { eventId, key: `${ALIAS_PREFIX}${a}`, value: b },
  });
}

export async function loadEmailAliases(eventId: string): Promise<Map<string, string>> {
  const rows = await prisma.setting.findMany({ where: { eventId, key: { startsWith: ALIAS_PREFIX } }, select: { key: true, value: true } });
  return new Map(rows.map((r: { key: string; value: string }) => [r.key.slice(ALIAS_PREFIX.length), r.value]));
}

/** The corrected address for `email`, following a chain of corrections (stops after a few steps, so a loop cannot hang). */
export function resolveEmail(aliases: Map<string, string>, email: string): string {
  let current = norm(email);
  for (let i = 0; i < 5; i++) {
    const next = aliases.get(current);
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

/**
 * Reads people coming from a sheet, CSV or form as their corrected address. If the sheet holds both the wrong and the
 * right row for the same person, they become one person: the first row wins and blanks are filled from the other.
 */
export async function applyEmailAliases(eventId: string, people: ImportedPerson[]): Promise<ImportedPerson[]> {
  const aliases = await loadEmailAliases(eventId);
  if (aliases.size === 0) return people;

  const out = new Map<string, ImportedPerson>();
  for (const p of people) {
    const email = resolveEmail(aliases, p.email);
    const person = email === p.email ? p : { ...p, email };
    const seen = out.get(email);
    if (!seen) {
      out.set(email, person);
      continue;
    }
    out.set(email, {
      ...seen,
      fullName: seen.fullName || person.fullName,
      phone: seen.phone || person.phone,
      followUpStatus: seen.followUpStatus ?? person.followUpStatus,
      callFeedback: seen.callFeedback || person.callFeedback,
      extra: { ...person.extra, ...seen.extra },
    });
  }
  return [...out.values()];
}
