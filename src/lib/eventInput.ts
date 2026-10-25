import { DEFAULT_TERMS, MAX_TERM_LENGTH, TIMEZONES, eventType, normalizeHex, type Terms } from "@/lib/eventTheme";

/** An https address typed or pasted by an admin. Returns "" for empty, null when it isn't usable. */
export function cleanLink(value: unknown): string | null {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (!v) return "";
  if (v.length > 500) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Wording as typed in the wizard. Anything empty falls back to the default. */
export function cleanTerms(value: unknown): Terms {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Terms>;
  const one = (x: unknown, fallback: string) => (typeof x === "string" && x.trim() ? x.trim().replace(/\s+/g, " ").slice(0, MAX_TERM_LENGTH) : fallback);
  return { person: one(v.person, DEFAULT_TERMS.person), people: one(v.people, DEFAULT_TERMS.people), action: one(v.action, DEFAULT_TERMS.action) };
}

export function cleanTimezone(value: unknown): string | null {
  return typeof value === "string" && TIMEZONES.some((t) => t.id === value) ? value : null;
}

export function cleanType(value: unknown): string | null {
  return typeof value === "string" && eventType(value).id === value ? value : null;
}

export function cleanColor(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  return normalizeHex(value) ?? undefined;
}

export function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}
