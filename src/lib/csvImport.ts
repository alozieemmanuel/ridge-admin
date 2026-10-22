import { parse } from "csv-parse/sync";
import { normalizeFollowUp, type FollowUpStatus } from "@/lib/followUp";

/** The fields a CSV column can be sent to. "extra" keeps the column as-is on the participant's record; "ignore" drops it. */
export const IMPORT_FIELDS = [
  { value: "fullName", label: "Full name" },
  { value: "firstName", label: "First name (joined with last name)" },
  { value: "lastName", label: "Last name (joined with first name)" },
  { value: "email", label: "Email address" },
  { value: "phone", label: "Phone number" },
  { value: "organization", label: "Company / organisation" },
  { value: "followUp", label: "Follow-up status" },
  { value: "callFeedback", label: "Call feedback" },
  { value: "extra", label: "Keep as extra detail" },
  { value: "ignore", label: "Ignore this column" },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["value"];
const FIELD_VALUES = IMPORT_FIELDS.map((f) => f.value) as string[];
export const isImportField = (v: unknown): v is ImportField => typeof v === "string" && FIELD_VALUES.includes(v);

const ALIASES: Record<Exclude<ImportField, "extra" | "ignore">, string[]> = {
  fullName: ["full name", "fullname", "name", "full names", "guest name", "guest", "participant", "participant name", "invitee", "contact name"],
  firstName: ["first name", "firstname", "given name", "forename"],
  lastName: ["last name", "lastname", "surname", "family name"],
  email: ["email", "email address", "e-mail", "e mail", "mail", "email id", "emailaddress"],
  phone: ["phone", "phone number", "phone no", "mobile", "mobile number", "mobile no", "telephone", "tel", "contact number", "whatsapp", "whatsapp number", "phone/whatsapp"],
  organization: ["organization", "organisation", "company", "company name", "business", "business name", "firm", "employer", "company / organization", "company/organisation"],
  followUp: ["follow-up", "follow up", "followup", "follow-up status", "follow up status", "status", "call status", "call outcome", "outcome", "response"],
  callFeedback: ["feedback", "call feedback", "call notes", "call note", "calls feedback", "comment", "comments", "remark", "remarks", "notes", "note", "call summary", "feedback from call", "feedback from calls"],
};

const norm = (h: string) => h.trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ");

/** Suggests where each header should go, using common spreadsheet names. Each target is used by one column only. */
export function suggestMapping(headers: string[]): Record<string, ImportField> {
  const mapping: Record<string, ImportField> = {};
  const used = new Set<string>();
  for (const header of headers) {
    const n = norm(header);
    let found: ImportField | null = null;
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (aliases.includes(n) && !used.has(field)) {
        found = field as ImportField;
        break;
      }
    }
    if (found) {
      used.add(found);
      mapping[header] = found;
    } else {
      mapping[header] = "extra";
    }
  }
  // If the sheet has first + last name columns and no single name column, they will be joined; otherwise a lone first name is the name.
  if (!used.has("fullName") && used.has("firstName") && !used.has("lastName")) {
    for (const h of headers) if (mapping[h] === "firstName") mapping[h] = "fullName";
  }
  return mapping;
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/** Reads CSV text (also tab / semicolon separated). Throws an Error with a plain message when it can't be read. */
export function parseCsvText(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, "");
  if (!clean.trim()) throw new Error("The file is empty.");
  const firstLine = clean.split(/\r?\n/, 1)[0];
  const counts: [string, number][] = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length]);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];

  let records: string[][];
  try {
    records = parse(clean, { delimiter, relax_column_count: true, skip_empty_lines: true, trim: true, bom: true, relax_quotes: true }) as string[][];
  } catch (err) {
    throw new Error(`The file could not be read as a CSV (${err instanceof Error ? err.message : "unknown error"}).`);
  }
  if (records.length < 2) throw new Error("The file needs a header row and at least one row of data.");

  // Blank or repeated header names would collide, so they are made unique.
  const seen = new Map<string, number>();
  const headers = records[0].map((h, i) => {
    const base = h || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const rows = records.slice(1).map((r) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (r[i] ?? "").trim()));
    return row;
  });
  return { headers, rows };
}

export const EMAIL_RE = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;

export interface ImportedPerson {
  rowNumber: number; // the row in the spreadsheet (header = row 1)
  fullName: string;
  email: string;
  phone: string;
  organization: string | null;
  followUpStatus: FollowUpStatus | null;
  callFeedback: string | null;
  extra: Record<string, string>;
}

export interface RowProblem {
  rowNumber: number;
  reason: string;
  name?: string;
}

/**
 * Cleans a phone number typed in a spreadsheet. A number Excel turned into scientific notation (2.3481E+12)
 * has already lost its last digits, so it is kept as written (it looks wrong on purpose) instead of being guessed.
 */
function cleanPhone(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Applies the column mapping. Rows with no usable email are reported, rows repeating an email in the same file are reported too. */
export function buildPeople(parsed: ParsedCsv, mapping: Record<string, ImportField>): { people: ImportedPerson[]; problems: RowProblem[] } {
  const by = (field: ImportField) => parsed.headers.filter((h) => mapping[h] === field);
  const people: ImportedPerson[] = [];
  const problems: RowProblem[] = [];
  const seenEmails = new Set<string>();

  parsed.rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const first = (field: ImportField) => by(field).map((h) => row[h]).find((v) => v) ?? "";

    const first1 = first("firstName");
    const last1 = first("lastName");
    const fullName = (first("fullName") || [first1, last1].filter(Boolean).join(" ")).replace(/\s+/g, " ").trim();
    const email = first("email").toLowerCase().replace(/^mailto:/, "").trim();

    const extra: Record<string, string> = {};
    for (const h of by("extra")) if (row[h]) extra[h] = row[h];

    const feedbackParts = by("callFeedback").map((h) => row[h]).filter(Boolean);
    const followUpRaw = first("followUp");
    let followUpStatus = normalizeFollowUp(followUpRaw);
    // A status column that says something we can't classify is not thrown away: it joins the feedback.
    if (followUpRaw && !followUpStatus) feedbackParts.unshift(`Follow-up: ${followUpRaw}`);

    if (!fullName && !email) {
      if (Object.values(row).every((v) => !v)) return; // a blank row
      problems.push({ rowNumber, reason: "No name and no email address." });
      return;
    }
    if (!email) {
      problems.push({ rowNumber, name: fullName, reason: "No email address, so they can't be invited." });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      problems.push({ rowNumber, name: fullName, reason: `"${email}" is not a valid email address.` });
      return;
    }
    if (seenEmails.has(email)) {
      problems.push({ rowNumber, name: fullName, reason: `Repeats ${email}, which appears earlier in this file.` });
      return;
    }
    seenEmails.add(email);

    // With a call-feedback note but no status column, a note is still usable as a hint that they were reached.
    if (!followUpStatus && feedbackParts.length > 0 && !followUpRaw) followUpStatus = null;

    people.push({
      rowNumber,
      fullName: fullName || email.split("@")[0],
      email,
      phone: cleanPhone(first("phone")),
      organization: first("organization") || null,
      followUpStatus,
      callFeedback: feedbackParts.length ? feedbackParts.join("\n") : null,
      extra,
    });
  });

  return { people, problems };
}
