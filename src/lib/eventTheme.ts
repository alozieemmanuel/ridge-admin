/**
 * Everything about how an event looks and what it calls things. Safe for both server and client code.
 *   - the accent colour (picked per event) and the CSS variables derived from it,
 *   - the wording sets (Contacts, Registrations, Guests...),
 *   - the event types offered in the wizard.
 */

export const DEFAULT_COLOR = "#A3E635";

export const COLOR_PRESETS: { name: string; hex: string }[] = [
  { name: "Lemon", hex: "#A3E635" },
  { name: "Red", hex: "#DC2626" },
  { name: "Orange", hex: "#EA580C" },
  { name: "Amber", hex: "#D97706" },
  { name: "Teal", hex: "#0D9488" },
  { name: "Blue", hex: "#2563EB" },
  { name: "Violet", hex: "#7C3AED" },
  { name: "Pink", hex: "#DB2777" },
  { name: "Slate", hex: "#475569" },
];

type RGB = [number, number, number];

/** "#abc", "abc" or "#AABBCC" becomes "#AABBCC". Anything else becomes null. */
export function normalizeHex(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) return `#${raw.split("").map((c) => c + c).join("").toUpperCase()}`;
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  return null;
}

function toRgb(hex: string): RGB {
  const h = (normalizeHex(hex) ?? DEFAULT_COLOR).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Blends `a` towards `b`: t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The text colour that reads best on top of this colour (used on buttons). */
export function onColor(hex: string): string {
  return contrast(hex, "#FFFFFF") >= contrast(hex, "#141C08") ? "#FFFFFF" : "#141C08";
}

/** A shade of the colour that is dark enough for small text on white. */
export function textOnWhite(hex: string): string {
  let c = normalizeHex(hex) ?? DEFAULT_COLOR;
  for (let i = 0; i < 12 && contrast(c, "#FFFFFF") < 4.5; i++) c = mix(c, "#000000", 0.12);
  return c;
}

/** A shade of the colour that is light enough for small text on the dark theme. */
export function textOnDark(hex: string): string {
  let c = normalizeHex(hex) ?? DEFAULT_COLOR;
  for (let i = 0; i < 12 && contrast(c, "#0C0F08") < 6; i++) c = mix(c, "#FFFFFF", 0.14);
  return c;
}

function triplet(hex: string): string {
  return toRgb(hex).join(" ");
}

/**
 * CSS variables for one event, to put on the element that wraps its pages (see .event-themed in globals.css).
 * With no colour the default theme is used and nothing is overridden.
 */
export function themeStyle(color: string | null | undefined): Record<string, string> | undefined {
  const hex = normalizeHex(color);
  if (!hex || hex === DEFAULT_COLOR) return undefined;
  return {
    "--c-gold": triplet(hex),
    "--c-goldlight": triplet(mix(hex, "#FFFFFF", 0.22)),
    "--c-golddark": triplet(mix(hex, "#000000", 0.14)),
    "--c-on-gold": triplet(onColor(hex)),
    "--c-accent-text-light": triplet(textOnWhite(hex)),
    "--c-accent-text-dark": triplet(textOnDark(hex)),
    "--c-tint-light": triplet(mix(hex, "#FFFFFF", 0.93)),
    "--c-tint-dark": triplet(mix(hex, "#0C0C0C", 0.9)),
    // Greys with a hint of the event colour, so no trace of the default green is left in the page, the cards, the lines or the text.
    "--c-lt-border": triplet(mix("#E4E4E4", hex, 0.14)),
    "--c-lt-muted": triplet(mix("#5E5E5E", hex, 0.1)),
    "--c-lt-fg": triplet(mix("#171717", hex, 0.07)),
    "--c-dk-pagebg": triplet(mix("#0C0C0C", hex, 0.04)),
    "--c-dk-cardbg": triplet(mix("#141414", hex, 0.055)),
    "--c-dk-border": triplet(mix("#2E2E2E", hex, 0.1)),
    "--c-dk-muted": triplet(mix("#A3A3A3", hex, 0.12)),
    "--c-dk-fg": triplet(mix("#F5F5F5", hex, 0.05)),
  };
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

export interface Terms {
  person: string;
  people: string;
  /** The button on the guest's reserve page. */
  action: string;
}

export const DEFAULT_TERMS: Terms = { person: "Contact", people: "Contacts", action: "Reserve my seat" };

export const PEOPLE_WORDS: { person: string; people: string }[] = [
  { person: "Contact", people: "Contacts" },
  { person: "Registration", people: "Registrations" },
  { person: "Guest", people: "Guests" },
  { person: "Delegate", people: "Delegates" },
  { person: "Attendee", people: "Attendees" },
  { person: "Participant", people: "Participants" },
  { person: "Member", people: "Members" },
];

export const ACTION_WORDS: string[] = ["Reserve my seat", "Register", "Confirm attendance", "RSVP", "Get my ticket"];

export const MAX_TERM_LENGTH = 24;

/** Reads the saved wording of an event, filling anything missing with the defaults. */
export function termsOf(value: unknown): Terms {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Terms>;
  const clean = (x: unknown, fallback: string) => (typeof x === "string" && x.trim() ? x.trim().slice(0, MAX_TERM_LENGTH) : fallback);
  return { person: clean(v.person, DEFAULT_TERMS.person), people: clean(v.people, DEFAULT_TERMS.people), action: clean(v.action, DEFAULT_TERMS.action) };
}

export function lower(word: string): string {
  return word.toLowerCase();
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface EventTypeOption {
  id: string;
  label: string;
  hint: string;
  modules: string[];
  terms: { person: string; people: string };
  online?: boolean;
  paid?: boolean;
}

export const EVENT_TYPES: EventTypeOption[] = [
  { id: "free", label: "Free event", hint: "Guests register, you invite them and check them in.", modules: ["invitations", "attendance", "campaigns"], terms: PEOPLE_WORDS[0] },
  { id: "paid", label: "Paid event", hint: "Same as a free event. Payments arrive in a later update.", modules: ["invitations", "attendance", "campaigns"], terms: PEOPLE_WORDS[1], paid: true },
  { id: "conference", label: "Conference", hint: "Many delegates, check-in on the day, regular emails.", modules: ["invitations", "attendance", "campaigns"], terms: PEOPLE_WORDS[3] },
  { id: "webinar", label: "Webinar", hint: "Online. Registrations and emails, no seats or check-in.", modules: ["campaigns"], terms: PEOPLE_WORDS[1], online: true },
  { id: "private", label: "Invite only", hint: "A small guest list, personal invitations and tickets.", modules: ["invitations", "attendance"], terms: PEOPLE_WORDS[2] },
];

export function eventType(id: string | null | undefined): EventTypeOption {
  return EVENT_TYPES.find((t) => t.id === id) ?? EVENT_TYPES[0];
}

export const TIMEZONES: { id: string; label: string }[] = [
  { id: "Africa/Lagos", label: "Lagos (WAT)" },
  { id: "Africa/Accra", label: "Accra (GMT)" },
  { id: "Africa/Nairobi", label: "Nairobi (EAT)" },
  { id: "Africa/Johannesburg", label: "Johannesburg (SAST)" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Paris", label: "Paris, Berlin" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Singapore", label: "Singapore" },
];

/** How often a connected sheet is read when nobody has the page open. 0 means only when someone presses Sync. */
export const SYNC_INTERVALS: { minutes: number; label: string }[] = [
  { minutes: 5, label: "Every 5 minutes" },
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 0, label: "Only when I press Sync" },
];
