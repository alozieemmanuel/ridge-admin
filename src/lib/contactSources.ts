import { randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { EMAIL_RE, buildPeople, suggestMapping, type ParsedCsv, type RowProblem } from "@/lib/csvImport";
import { saveImportedPeople } from "@/lib/contactSave";
import { SHEET_INTERVAL_KEY, SHEET_KEYS, getSheetInterval, type LastSync, type SyncResult } from "@/lib/contactSheet";

/**
 * Where an event's contacts come from. One choice per event (Event.dataSource):
 *   sheet     a live Google Sheet (src/lib/contactSheet.ts)
 *   supabase  a table in the owner's Supabase project, read on the server
 *   form      the event's website form posts to a secret address (src/app/api/public/intake)
 *   manual    nothing automatic: CSV import and "Add a contact"
 * Contacts can always be added by hand or by CSV, whatever the source.
 */
import { DATA_SOURCES, isDataSource, type DataSourceId } from "@/lib/dataSources";
export { DATA_SOURCES, isDataSource };
export type { DataSourceId };

export const SUPABASE_URL_KEY = "source_supabase_url";
export const SUPABASE_TABLE_KEY = "source_supabase_table";
/** The key is a secret: it is never sent back to the browser. */
export const SUPABASE_KEY_KEY = "source_supabase_key";
export const SUPABASE_LAST_SYNC_KEY = "source_supabase_last_sync";
export const INTAKE_ORIGINS_KEY = "intake_origins";
export const SOURCE_KEYS = [SUPABASE_URL_KEY, SUPABASE_TABLE_KEY, SUPABASE_KEY_KEY, SUPABASE_LAST_SYNC_KEY, INTAKE_ORIGINS_KEY];
/** Settings that are managed by their own screens, kept out of the generic settings form. */
export const HIDDEN_SETTING_KEYS = [...SHEET_KEYS, ...SOURCE_KEYS];

async function readSetting(eventId: string, key: string): Promise<string | null> {
  return (await prisma.setting.findUnique({ where: { eventId_key: { eventId, key } } }))?.value ?? null;
}
async function writeSetting(eventId: string, key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { eventId_key: { eventId, key } }, update: { value }, create: { eventId, key, value } });
}

export function newIntakeToken(): string {
  return randomBytes(24).toString("base64url");
}

export function tokenMatches(given: string, expected: string | null): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------------------------

export function cleanSupabaseUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    const host = u.hostname.toLowerCase();
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[");
    if (u.protocol !== "https:" || !host.includes(".") || isIp || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
    return `https://${u.host}`;
  } catch {
    return null;
  }
}
export const cleanSupabaseTable = (input: string): string | null => (/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(input.trim()) ? input.trim() : null);

export interface SupabaseState {
  url: string;
  table: string;
  hasKey: boolean;
  lastSync: LastSync | null;
}

export async function getSupabaseState(eventId: string): Promise<SupabaseState> {
  const [url, table, key, last] = await Promise.all([
    readSetting(eventId, SUPABASE_URL_KEY),
    readSetting(eventId, SUPABASE_TABLE_KEY),
    readSetting(eventId, SUPABASE_KEY_KEY),
    readSetting(eventId, SUPABASE_LAST_SYNC_KEY),
  ]);
  let lastSync: LastSync | null = null;
  if (last) {
    try {
      lastSync = JSON.parse(last) as LastSync;
    } catch {
      lastSync = null;
    }
  }
  return { url: url ?? "", table: table ?? "", hasKey: Boolean(key), lastSync };
}

/** Saves the connection. An empty key keeps the saved one. Returns an error message when something is not usable. */
export async function saveSupabase(eventId: string, input: { url: string; table: string; key?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = cleanSupabaseUrl(input.url);
  if (!url) return { ok: false, error: "The project address must start with https:// and look like https://abcd.supabase.co." };
  const table = cleanSupabaseTable(input.table);
  if (!table) return { ok: false, error: "The table name can only have letters, numbers and underscores." };
  const key = (input.key ?? "").trim();
  if (!key && !(await readSetting(eventId, SUPABASE_KEY_KEY))) return { ok: false, error: "Paste the API key from your Supabase project." };
  if (key && (key.length < 20 || key.length > 4000 || /\s/.test(key))) return { ok: false, error: "That does not look like a Supabase API key." };
  await writeSetting(eventId, SUPABASE_URL_KEY, url);
  await writeSetting(eventId, SUPABASE_TABLE_KEY, table);
  if (key) await writeSetting(eventId, SUPABASE_KEY_KEY, key);
  return { ok: true };
}

export async function clearSupabase(eventId: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { eventId, key: { in: [SUPABASE_URL_KEY, SUPABASE_TABLE_KEY, SUPABASE_KEY_KEY, SUPABASE_LAST_SYNC_KEY] } } });
}

const PAGE = 1000;
const MAX_PAGES = 10;

async function fetchSupabaseRows(url: string, table: string, key: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?select=*`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", Range: `${page * PAGE}-${page * PAGE + PAGE - 1}`, "Range-Unit": "items" },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("Could not reach Supabase. Check the project address.");
    }
    if (res.status === 401 || res.status === 403) throw new Error("Supabase refused the key. Use the service_role key, or allow this table to be read with the anon key.");
    if (res.status === 404) throw new Error(`The table "${table}" was not found. Check the name.`);
    if (!res.ok && res.status !== 206) throw new Error(`Supabase answered with error ${res.status}.`);
    const batch = (await res.json().catch(() => null)) as Record<string, unknown>[] | null;
    if (!Array.isArray(batch)) throw new Error("Supabase did not return a list of rows.");
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

/** Turns database rows into the same shape a CSV has, so they go through the same checks as a CSV import. */
export function rowsToCsv(rows: Record<string, unknown>[]): ParsedCsv {
  const skip = new Set(["id", "updated_at"]);
  const headers: string[] = [];
  for (const row of rows) for (const k of Object.keys(row)) if (!skip.has(k) && !headers.includes(k)) headers.push(k);
  const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).trim();
  return { headers, rows: rows.map((r) => Object.fromEntries(headers.map((h) => [h, text(r[h])]))) };
}

async function recordSupabaseResult(eventId: string, value: LastSync) {
  await writeSetting(eventId, SUPABASE_LAST_SYNC_KEY, JSON.stringify(value));
}

/** Reads the event's Supabase table and adds or updates contacts by email. Nobody is emailed. */
export async function syncSupabase(eventId: string, opts: { minGapMs?: number } = {}): Promise<SyncResult | { skipped: true }> {
  const [state, key] = await Promise.all([getSupabaseState(eventId), readSetting(eventId, SUPABASE_KEY_KEY)]);
  if (!state.url || !state.table || !key) throw new Error("Save the Supabase connection first.");
  if (opts.minGapMs && state.lastSync?.ok && Date.now() - new Date(state.lastSync.at).getTime() < opts.minGapMs) return { skipped: true };

  const fail = async (error: string): Promise<never> => {
    await recordSupabaseResult(eventId, { at: new Date().toISOString(), ok: false, error });
    throw new Error(error);
  };

  let raw: Record<string, unknown>[];
  try {
    raw = await fetchSupabaseRows(state.url, state.table, key);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Supabase could not be read.");
  }

  const parsed = rowsToCsv(raw);
  const mapping = suggestMapping(parsed.headers);
  const fields = new Set(Object.values(mapping));
  if (raw.length && (!fields.has("email") || !(fields.has("fullName") || fields.has("firstName")))) {
    return fail("The table needs a column for the email address and a column for the name, for example email and full_name.");
  }

  const { people, problems } = buildPeople(parsed, mapping);
  const saved = await saveImportedPeople(eventId, people, "update", { author: "Imported from Supabase", overwriteStatus: false });
  const result: SyncResult = {
    at: new Date().toISOString(),
    ok: true,
    rows: parsed.rows.length,
    added: saved.added,
    updated: saved.updated,
    unchanged: saved.unchanged,
    problemCount: problems.length,
    problems: problems.slice(0, 50) as RowProblem[],
  };
  const { problems: _omit, ...stored } = result;
  void _omit;
  await recordSupabaseResult(eventId, stored);
  return result;
}

// ---------------------------------------------------------------------------------------------
// One person at a time: the website form and "Add a contact"
// ---------------------------------------------------------------------------------------------

export interface NewContact {
  fullName: string;
  email: string;
  phone?: string;
  extra?: Record<string, string>;
}

/** Adds one person, or fills in the details of someone already on the list (same email). Never blanks a field. */
export async function addOrUpdateContact(
  eventId: string,
  c: NewContact,
  author: string,
  opts: { emailOptional?: boolean } = {}
): Promise<{ result: "added" | "updated" | "unchanged" } | { error: string }> {
  const email = c.email.trim().toLowerCase();
  if (!email && opts.emailOptional) {
    // No email to match on, so this is always a new person. They are stored with email = "" and are skipped by every email send.
    const name = c.fullName.replace(/\s+/g, " ").trim();
    if (!name) return { error: "Enter the name." };
    await prisma.registration.create({ data: { eventId, fullName: name, email: "", phone: (c.phone ?? "").trim(), extra: c.extra && Object.keys(c.extra).length ? c.extra : undefined } });
    return { result: "added" };
  }
  if (!EMAIL_RE.test(email)) return { error: "That email address does not look right." };
  const fullName = c.fullName.replace(/\s+/g, " ").trim() || email.split("@")[0];
  const saved = await saveImportedPeople(
    eventId,
    [{ rowNumber: 1, fullName, email, phone: (c.phone ?? "").trim(), followUpStatus: null, callFeedback: null, extra: c.extra ?? {} }],
    "update",
    { author, overwriteStatus: false }
  );
  return { result: saved.added ? "added" : saved.updated ? "updated" : "unchanged" };
}

/** Which events the scheduled job should read, and with which source. */
export async function sourceInterval(eventId: string): Promise<number> {
  return getSheetInterval(eventId);
}
export { SHEET_INTERVAL_KEY };
