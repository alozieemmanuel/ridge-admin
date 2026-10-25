import { prisma } from "@/lib/prisma";
import type { ImportedPerson } from "@/lib/csvImport";

const CHUNK = 500;

export interface SaveResult {
  added: number;
  updated: number;
  /** Already on the list and left alone (onDuplicate = "skip"). */
  skipped: number;
  /** Already on the list, "update" was on, and nothing in the file was new. */
  unchanged: number;
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/** Compares two "extra" objects without caring about key order (the database may return the keys in another order). */
function sameExtra(a: unknown, b: Record<string, string>): boolean {
  const left = (a && typeof a === "object" ? (a as Record<string, unknown>) : {}) as Record<string, unknown>;
  const lk = Object.keys(left).sort();
  const rk = Object.keys(b).sort();
  return lk.length === rk.length && lk.every((k, i) => k === rk[i] && String(left[k]) === b[k]);
}

/**
 * Saves people read from a CSV file or a live sheet into one event. Nobody is emailed.
 *
 *   New emails are added. Call feedback that came with a person becomes the first entry in their follow-up log.
 *   Emails already on the list are left alone ("skip") or filled in from the file ("update"). An update never blanks a
 *   field, never touches a reservation, and never adds a follow-up entry that is already in the log, so running it
 *   again and again (as the live sheet does) is safe.
 *
 *   overwriteStatus: true  the file's follow-up status always replaces the current one (one-off CSV import).
 *                    false the file's status is only used when it brings a new call note, or the guest has not been contacted yet.
 *                           This keeps what the team set in the dashboard from being undone by an older row in the sheet.
 */
export async function saveImportedPeople(
  eventId: string,
  people: ImportedPerson[],
  onDuplicate: "skip" | "update",
  opts: { author?: string; overwriteStatus?: boolean } = {}
): Promise<SaveResult> {
  const author = opts.author ?? "Imported from CSV";
  const overwriteStatus = opts.overwriteStatus ?? true;

  const existing: { id: string; email: string; fullName: string; phone: string; followUpStatus: string; extra: unknown }[] = [];
  for (const part of chunks(people.map((p) => p.email))) {
    existing.push(
      ...(await prisma.registration.findMany({
        where: { eventId, email: { in: part } },
        select: { id: true, email: true, fullName: true, phone: true, followUpStatus: true, extra: true },
      }))
    );
  }
  const byEmail = new Map(existing.map((e) => [e.email, e]));
  const fresh = people.filter((p) => !byEmail.has(p.email));
  const dups = people.filter((p) => byEmail.has(p.email));

  let added = 0;
  for (const part of chunks(fresh)) {
    const res = await prisma.registration.createMany({
      skipDuplicates: true,
      data: part.map((p) => ({
        eventId,
        fullName: p.fullName,
        email: p.email,
        phone: p.phone,
        followUpStatus: p.followUpStatus ?? "NOT_CONTACTED",
        extra: Object.keys(p.extra).length ? p.extra : undefined,
      })),
    });
    added += res.count;
  }

  // Feedback that came in with the file becomes the first entry in each new guest's follow-up log.
  const withFeedback = fresh.filter((p) => p.callFeedback);
  for (const part of chunks(withFeedback)) {
    const rows = await prisma.registration.findMany({ where: { eventId, email: { in: part.map((p) => p.email) } }, select: { id: true, email: true } });
    const idByEmail = new Map(rows.map((r: { id: string; email: string }) => [r.email, r.id]));
    await prisma.followUpNote.createMany({
      data: part.flatMap((p) => {
        const registrationId = idByEmail.get(p.email);
        return registrationId ? [{ registrationId, body: p.callFeedback!, status: p.followUpStatus, authorName: author }] : [];
      }),
    });
  }

  let updated = 0;
  let unchanged = 0;
  if (onDuplicate === "update" && dups.length) {
    // The notes already in each guest's log, so the same line is never added twice.
    const known = new Set<string>();
    for (const part of chunks(dups.map((p) => byEmail.get(p.email)!.id))) {
      const notes = await prisma.followUpNote.findMany({ where: { registrationId: { in: part } }, select: { registrationId: true, body: true } });
      for (const n of notes) known.add(`${n.registrationId}\n${n.body}`);
    }

    for (const p of dups) {
      const current = byEmail.get(p.email)!;
      const data: Record<string, unknown> = {};
      if (p.fullName && p.fullName !== current.fullName) data.fullName = p.fullName;
      if (p.phone && p.phone !== current.phone) data.phone = p.phone;
      if (Object.keys(p.extra).length && !sameExtra(current.extra, p.extra)) data.extra = p.extra;

      const newNote = Boolean(p.callFeedback) && !known.has(`${current.id}\n${p.callFeedback}`);
      if (p.followUpStatus && p.followUpStatus !== current.followUpStatus && (overwriteStatus || newNote || current.followUpStatus === "NOT_CONTACTED")) {
        data.followUpStatus = p.followUpStatus;
      }

      if (Object.keys(data).length) await prisma.registration.update({ where: { id: current.id }, data });
      if (newNote) {
        await prisma.followUpNote.create({ data: { registrationId: current.id, body: p.callFeedback!, status: p.followUpStatus, authorName: author } });
      }
      if (Object.keys(data).length || newNote) updated++;
      else unchanged++;
    }
  }

  return { added, updated, skipped: onDuplicate === "skip" ? dups.length : 0, unchanged };
}
