/**
 * Column matching for prospect sheets.
 *
 * Every sheet (the Prospects sheet today, digital-marketing lead sheets later)
 * can name its columns differently. Each sheet header is matched to one of the
 * fields below, in this order:
 *   1. a manual override saved for that sheet (ProspectSource.columnMap),
 *   2. an exact match on a known name (ignoring case, spaces and punctuation),
 *   3. a looser "contains" match on longer names.
 * Columns that match nothing are kept as-is in `extra` (campaign, ad name, ...).
 */

export type ProspectFieldKey =
  | "fullName"
  | "email"
  | "phone"
  | "callRequested"
  | "callSchedule"
  | "callCompleted"
  | "callFeedback"
  | "followUpRequired"
  | "confirmation"
  | "externalId";

export interface ProspectField {
  key: ProspectFieldKey;
  label: string;
  aliases: string[];
  /** Fields the admin can edit in the dashboard (and that are written back to the sheet). */
  editable?: boolean;
}

export const RIDGE_ID_HEADER = "RIDGE ID";

export const PROSPECT_FIELDS: ProspectField[] = [
  {
    key: "fullName",
    label: "Full Name",
    aliases: ["full name", "name", "fullname", "prospect name", "lead name", "contact name", "full_name", "names"],
  },
  { key: "email", label: "Email", aliases: ["email", "email address", "e-mail", "mail", "email id"] },
  {
    key: "phone",
    label: "Phone",
    aliases: [
      "phone",
      "phone number",
      "phone_number",
      "mobile",
      "mobile number",
      "whatsapp",
      "whatsapp number",
      "telephone",
      "tel",
      "contact number",
      "phone no",
    ],
  },
  {
    key: "callRequested",
    label: "Request for Call",
    editable: true,
    aliases: [
      "request for call",
      "call request",
      "request call",
      "call requested",
      "request a call",
      "requested call",
      "wants a call",
      "status",
      "lead status",
      "prospect status",
    ],
  },
  {
    key: "callSchedule",
    label: "Time Schedule for Call",
    editable: true,
    aliases: [
      "time schedule for call",
      "call schedule",
      "schedule for call",
      "call time",
      "time for call",
      "preferred call time",
      "call date",
      "call date and time",
      "scheduled time",
      "time schedule",
    ],
  },
  {
    key: "callCompleted",
    label: "Call Completed",
    editable: true,
    aliases: ["call completed", "call done", "call made", "completed", "called", "call status"],
  },
  {
    key: "callFeedback",
    label: "Feedback from Call",
    editable: true,
    aliases: ["feedback from call", "call feedback", "feedback", "call notes", "notes from call", "call outcome"],
  },
  {
    key: "followUpRequired",
    label: "Follow-up Call Required?",
    editable: true,
    aliases: [
      "follow-up call required",
      "follow up call required",
      "follow up required",
      "followup required",
      "follow up call",
      "follow-up call",
      "follow up",
      "follow-up",
      "needs follow up",
    ],
  },
  {
    key: "confirmation",
    label: "Confirmation",
    editable: true,
    aliases: ["confirmation", "confirmed", "confirmation status", "registration confirmation"],
  },
  { key: "externalId", label: RIDGE_ID_HEADER, aliases: ["ridge id", "ridgeid", "prospect id", "lead id"] },
];

export const FIELD_BY_KEY: Record<ProspectFieldKey, ProspectField> = Object.fromEntries(
  PROSPECT_FIELDS.map((f) => [f.key, f])
) as Record<ProspectFieldKey, ProspectField>;

export const EDITABLE_FIELDS = PROSPECT_FIELDS.filter((f) => f.editable).map((f) => f.key);

/** Lowercase and strip everything except letters and digits. "Follow-up Call Required?" -> "followupcallrequired". */
export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type ColumnMapping = Partial<Record<ProspectFieldKey, number>>;
export type ManualColumnMap = Partial<Record<ProspectFieldKey, string>>;

export interface ResolvedMapping {
  /** field -> column index in the sheet */
  mapping: ColumnMapping;
  /** how each mapped field was matched, for showing in the UI */
  how: Partial<Record<ProspectFieldKey, "manual" | "exact" | "similar">>;
}

/**
 * Works out which sheet column feeds which field.
 * `headers` is the sheet's first row; `manual` is the saved per-sheet override.
 */
export function resolveColumns(headers: string[], manual?: ManualColumnMap | null): ResolvedMapping {
  const normalized = headers.map((h) => normalizeHeader(h ?? ""));
  const mapping: ColumnMapping = {};
  const how: ResolvedMapping["how"] = {};
  const usedColumns = new Set<number>();

  // 1. Manual overrides
  for (const field of PROSPECT_FIELDS) {
    const wanted = manual?.[field.key];
    if (!wanted) continue;
    const idx = normalized.findIndex((h, i) => !usedColumns.has(i) && h !== "" && h === normalizeHeader(wanted));
    if (idx >= 0) {
      mapping[field.key] = idx;
      how[field.key] = "manual";
      usedColumns.add(idx);
    }
  }

  // 2. Exact alias matches
  for (const field of PROSPECT_FIELDS) {
    if (mapping[field.key] !== undefined) continue;
    const aliases = field.aliases.map(normalizeHeader);
    const idx = normalized.findIndex((h, i) => !usedColumns.has(i) && h !== "" && aliases.includes(h));
    if (idx >= 0) {
      mapping[field.key] = idx;
      how[field.key] = "exact";
      usedColumns.add(idx);
    }
  }

  // 3. Looser matches: the header contains a fairly long alias, or is a long piece of one.
  for (const field of PROSPECT_FIELDS) {
    if (mapping[field.key] !== undefined) continue;
    const aliases = field.aliases.map(normalizeHeader).filter((a) => a.length >= 8);
    let best = -1;
    let bestScore = 0;
    normalized.forEach((h, i) => {
      if (usedColumns.has(i) || h.length < 6) return;
      // A "FOLLOW-UP DATE" column is a date, not a yes/no answer, so never guess it into another field.
      if (field.key !== "callSchedule" && /date|time/.test(h)) return;
      for (const a of aliases) {
        if (h.includes(a) || a.includes(h)) {
          const score = Math.min(a.length, h.length);
          if (score > bestScore) {
            best = i;
            bestScore = score;
          }
        }
      }
    });
    if (best >= 0) {
      mapping[field.key] = best;
      how[field.key] = "similar";
      usedColumns.add(best);
    }
  }

  return { mapping, how };
}

const TRUTHY = new Set(["true", "yes", "y", "1", "done", "completed", "complete", "x", "✓", "✔", "ok"]);

/** Reads a yes/no style cell. Empty or unknown text counts as No. */
export function parseBool(value: string | null | undefined): boolean {
  if (!value) return false;
  return TRUTHY.has(value.trim().toLowerCase());
}

/**
 * Sheets that use one STATUS column (a dropdown of words) instead of separate
 * yes/no columns. The STATUS word is stored in "Request for Call" and the other
 * yes/no answers are worked out from it. Unknown words are left alone.
 */
export const STATUS_OPTIONS = ["Text sent", "Call Scheduled", "Call Completed", "Follow Up", "Not Interested", "Registered"];

export interface StatusMeaning {
  requested: boolean;
  completed: boolean;
  followUp: boolean;
}

const STATUS_MEANING: Record<string, StatusMeaning> = {
  textsent: { requested: false, completed: false, followUp: false },
  callscheduled: { requested: true, completed: false, followUp: false },
  callcompleted: { requested: true, completed: true, followUp: false },
  followup: { requested: true, completed: true, followUp: true },
  notinterested: { requested: false, completed: false, followUp: false },
  registered: { requested: true, completed: true, followUp: false },
};

/** Returns what a STATUS word means, or null if the text is not one of the known status words. */
export function interpretStatus(value: string | null | undefined): StatusMeaning | null {
  if (!value) return null;
  return STATUS_MEANING[normalizeHeader(value)] ?? null;
}

/**
 * What to write back for a yes/no field. If the cell currently holds
 * TRUE/FALSE it is a checkbox, so keep that style; otherwise write Yes/No.
 */
export function formatBoolForSheet(value: boolean, currentCell: string | undefined): string {
  const current = (currentCell ?? "").trim().toUpperCase();
  if (current === "TRUE" || current === "FALSE") return value ? "TRUE" : "FALSE";
  return value ? "Yes" : "No";
}