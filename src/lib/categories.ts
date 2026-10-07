/**
 * The "What best describes you?" options on the register page. `value` is the
 * exact text the page submits; `label` is the shorter name used in the admin.
 */
export const REGISTRATION_CATEGORIES = [
  { value: "Aspiring real estate entrepreneur", label: "Aspiring entrepreneur" },
  { value: "Real estate professional or realtor", label: "Realtor / Brokerage" },
  { value: "Property developer", label: "Property developer" },
  { value: "Business owner or SME owner", label: "Business / SME owner" },
  { value: "Diaspora investor", label: "Diaspora investor" },
  { value: "Mortgage or finance professional", label: "Mortgage / Finance" },
  { value: "Other", label: "Other" },
] as const;

export const CATEGORY_VALUES: string[] = REGISTRATION_CATEGORIES.map((c) => c.value);

export function isCategory(value: unknown): value is string {
  return typeof value === "string" && CATEGORY_VALUES.includes(value);
}

export function categoryLabel(value: string): string {
  return REGISTRATION_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

const NOTES_PREFIX = "Describes self as:";

/** The register page puts the answers on the first line of the notes: "Describes self as: A; B". */
export function parseCategoriesFromNotes(notes: string | null | undefined): string[] {
  if (!notes) return [];
  const firstLine = notes.split(/\r?\n/)[0].trim();
  if (!firstLine.startsWith(NOTES_PREFIX)) return [];
  return firstLine
    .slice(NOTES_PREFIX.length)
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Keeps known categories only (unknown answers count as "Other"), without duplicates. */
export function normalizeCategories(values: string[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const known = isCategory(v) ? v : "Other";
    if (!out.includes(known)) out.push(known);
  }
  return out;
}
