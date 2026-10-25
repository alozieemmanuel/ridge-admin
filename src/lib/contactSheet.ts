import { prisma } from "@/lib/prisma";
import { buildPeople, parseCsvText, suggestMapping, type RowProblem } from "@/lib/csvImport";
import { saveImportedPeople } from "@/lib/contactSave";

/**
 * The live sheet: one Google Sheet link per event, kept in that event's settings. "Sync" reads the sheet and adds or updates
 * contacts by email, exactly like a CSV import (nobody is emailed). The sheet has to be shared as
 * "Anyone with the link can view", or published to the web as CSV, so no Google login is needed here.
 */

export const SHEET_URL_KEY = "contacts_sheet_url";
export const SHEET_LAST_SYNC_KEY = "contacts_sheet_last_sync";
/** Settings keys that belong to the live sheet. They are kept out of the Event details form and survive "clear everything". */
export const SHEET_INTERVAL_KEY = "contacts_sheet_interval";
export const SHEET_KEYS = [SHEET_URL_KEY, SHEET_LAST_SYNC_KEY, SHEET_INTERVAL_KEY];

export interface LastSync {
  at: string;
  ok: boolean;
  error?: string;
  rows?: number;
  added?: number;
  updated?: number;
  unchanged?: number;
  problemCount?: number;
}

export interface SyncResult extends LastSync {
  problems: RowProblem[];
}

/** Turns any Google Sheets link into the address that returns the sheet as CSV. Returns null when it isn't a usable link. */
export function toCsvUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  const isGoogle = url.hostname === "docs.google.com";
  if (!isGoogle) return url.toString(); // any other direct link to a CSV file

  // "Publish to the web" links (/d/e/...): ask for CSV.
  if (/^\/spreadsheets\/d\/e\//.test(url.pathname)) {
    const path = url.pathname.replace(/\/(pubhtml|pub)?$/, "") + "/pub";
    const out = new URL(`https://docs.google.com${path}`);
    out.searchParams.set("output", "csv");
    const gid = url.searchParams.get("gid");
    if (gid) out.searchParams.set("gid", gid);
    return out.toString();
  }

  const match = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  const gid = url.searchParams.get("gid") ?? new URLSearchParams(url.hash.replace(/^#/, "")).get("gid");
  const out = new URL(`https://docs.google.com/spreadsheets/d/${match[1]}/export`);
  out.searchParams.set("format", "csv");
  if (gid) out.searchParams.set("gid", gid);
  return out.toString();
}

const NOT_SHARED = "Google did not let this app read the sheet. In the sheet choose Share, then General access, then \"Anyone with the link\" as Viewer, and try again.";

async function fetchCsv(csvUrl: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(csvUrl, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error("Could not reach the sheet. Check the link and try again.");
  }
  if (res.status === 401 || res.status === 403) throw new Error(NOT_SHARED);
  if (res.status === 404) throw new Error("That sheet was not found. Check the link.");
  if (!res.ok) throw new Error(`The sheet could not be read (error ${res.status}).`);
  const type = res.headers.get("content-type") ?? "";
  const text = await res.text();
  // A sign-in page comes back as HTML with a 200.
  if (type.includes("text/html") || /^\s*<(!doctype|html)/i.test(text)) throw new Error(NOT_SHARED);
  return text;
}

async function readSetting(eventId: string, key: string): Promise<string | null> {
  return (await prisma.setting.findUnique({ where: { eventId_key: { eventId, key } } }))?.value ?? null;
}

async function writeSetting(eventId: string, key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { eventId_key: { eventId, key } }, update: { value }, create: { eventId, key, value } });
}

/** How often the server reads the sheet on its own, in minutes. 0 = only when someone presses Sync. */
export async function getSheetInterval(eventId: string): Promise<number> {
  const raw = await readSetting(eventId, SHEET_INTERVAL_KEY);
  const n = raw === null ? 5 : parseInt(raw, 10);
  return [0, 5, 15, 60].includes(n) ? n : 5;
}

export async function getSheetState(eventId: string): Promise<{ url: string; interval: number; lastSync: LastSync | null }> {
  const [url, last, interval] = await Promise.all([readSetting(eventId, SHEET_URL_KEY), readSetting(eventId, SHEET_LAST_SYNC_KEY), getSheetInterval(eventId)]);
  let lastSync: LastSync | null = null;
  if (last) {
    try {
      lastSync = JSON.parse(last) as LastSync;
    } catch {
      lastSync = null;
    }
  }
  return { url: url ?? "", interval, lastSync };
}

/** Saves (or, when empty, removes) the link. Returns an error message when the link isn't usable. */
export async function saveSheetInterval(eventId: string, minutes: number): Promise<void> {
  await writeSetting(eventId, SHEET_INTERVAL_KEY, String([0, 5, 15, 60].includes(minutes) ? minutes : 5));
}

export async function saveSheetUrl(eventId: string, input: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = input.trim();
  if (!trimmed) {
    await prisma.setting.deleteMany({ where: { eventId, key: { in: SHEET_KEYS } } });
    return { ok: true };
  }
  if (!toCsvUrl(trimmed)) return { ok: false, error: "That is not a Google Sheets link. Paste the address from the sheet's browser tab." };
  await writeSetting(eventId, SHEET_URL_KEY, trimmed);
  return { ok: true };
}

/**
 * Reads the saved sheet and adds or updates contacts by email.
 *   replace: delete every contact of THIS event first (their follow-up logs, email history and tickets go with them), then load the sheet.
 *            The sheet is read and checked BEFORE anything is deleted, so a bad link or a broken sheet deletes nothing.
 *   minGapMs: skip the work when the last sync was this recent (used by the automatic sync).
 */
export async function syncContactSheet(eventId: string, opts: { replace?: boolean; minGapMs?: number } = {}): Promise<SyncResult | { skipped: true }> {
  const { url, lastSync } = await getSheetState(eventId);
  if (!url) throw new Error("Save the sheet link first.");

  if (opts.minGapMs && lastSync?.ok && Date.now() - new Date(lastSync.at).getTime() < opts.minGapMs) return { skipped: true };

  const fail = async (error: string): Promise<never> => {
    await writeSetting(eventId, SHEET_LAST_SYNC_KEY, JSON.stringify({ at: new Date().toISOString(), ok: false, error } satisfies LastSync));
    throw new Error(error);
  };

  const csvUrl = toCsvUrl(url);
  if (!csvUrl) return fail("The saved link is not a Google Sheets link.");

  let text: string;
  try {
    text = await fetchCsv(csvUrl);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "The sheet could not be read.");
  }

  let parsed;
  try {
    parsed = parseCsvText(text);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "The sheet could not be read.");
  }

  const mapping = suggestMapping(parsed.headers);
  const fields = new Set(Object.values(mapping));
  if (!fields.has("email") || !(fields.has("fullName") || fields.has("firstName"))) {
    return fail("The sheet needs a column for the email address and a column for the name in its first row.");
  }

  const { people, problems } = buildPeople(parsed, mapping);
  if (opts.replace && people.length === 0) return fail("The sheet has no usable rows, so nothing was deleted.");

  if (opts.replace) await prisma.registration.deleteMany({ where: { eventId } });

  const saved = await saveImportedPeople(eventId, people, "update", { author: "Imported from sheet", overwriteStatus: false });
  const result: SyncResult = {
    at: new Date().toISOString(),
    ok: true,
    rows: parsed.rows.length,
    added: saved.added,
    updated: saved.updated,
    unchanged: saved.unchanged,
    problemCount: problems.length,
    problems: problems.slice(0, 50),
  };
  const { problems: _omit, ...stored } = result;
  void _omit;
  await writeSetting(eventId, SHEET_LAST_SYNC_KEY, JSON.stringify(stored satisfies LastSync));
  return result;
}
