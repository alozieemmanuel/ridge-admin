/**
 * Follow-up status of a participant: where the team is with them after the phone calls.
 * Safe to import from both server and client code.
 */

export const FOLLOW_UP_STATUSES = [
  { value: "NOT_CONTACTED", label: "Not contacted", tone: "text-muted" },
  { value: "CALLED_SPOKE", label: "Called, spoke to them", tone: "text-fg" },
  { value: "CALLED_NO_ANSWER", label: "Called, no answer", tone: "text-amber-300" },
  { value: "CALL_BACK", label: "Call back later", tone: "text-amber-300" },
  { value: "INTERESTED", label: "Interested", tone: "text-emerald-400" },
  { value: "NOT_INTERESTED", label: "Not interested", tone: "text-red-400" },
] as const;

export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number]["value"];

export const FOLLOW_UP_VALUES: string[] = FOLLOW_UP_STATUSES.map((s) => s.value);

export function isFollowUpStatus(value: unknown): value is FollowUpStatus {
  return typeof value === "string" && FOLLOW_UP_VALUES.includes(value);
}

export function followUpLabel(value: string | null | undefined): string {
  return FOLLOW_UP_STATUSES.find((s) => s.value === value)?.label ?? "Not contacted";
}

export function followUpTone(value: string | null | undefined): string {
  return FOLLOW_UP_STATUSES.find((s) => s.value === value)?.tone ?? "text-muted";
}

/**
 * Turns whatever was typed in a spreadsheet's follow-up / status column ("Interested", "No answer",
 * "call back tomorrow", "spoke with him"...) into one of the statuses above. Returns null when it
 * can't tell, so the importer can keep the original wording as call feedback instead of guessing.
 */
export function normalizeFollowUp(raw: string | null | undefined): FollowUpStatus | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return null;

  // Exact value or label (for a CSV that came out of this dashboard's own export).
  const exact = FOLLOW_UP_STATUSES.find((s) => s.value.toLowerCase() === t || s.label.toLowerCase() === t);
  if (exact) return exact.value;

  if (/\bnot\s+(yet\s+)?(contacted|called|reached)\b|\bno\s+call\b|\bnot\s+called\b|^pending$|^none$|^n\/a$/.test(t)) return "NOT_CONTACTED";
  if (/not\s+interested|uninterested|declined|decline|no\s+interest|won'?t\s+(come|attend)|cannot\s+attend|can'?t\s+attend|not\s+coming|not\s+attending/.test(t)) return "NOT_INTERESTED";
  if (/no\s+answer|didn'?t\s+(pick|answer)|did\s+not\s+(pick|answer)|not\s+pick|unreachable|not\s+reachable|switched\s+off|voice\s*mail|not\s+available|busy|line\s+was/.test(t)) return "CALLED_NO_ANSWER";
  if (/call\s*back|ring\s*back|call\s+(later|again|tomorrow)|follow\s*up\s+(later|again)|reschedul|try\s+again|later/.test(t)) return "CALL_BACK";
  if (/interested|keen|confirmed|will\s+(come|attend)|attending|coming|accepted|agreed|rsvp/.test(t)) return "INTERESTED";
  if (/spoke|spoken|reached|talked|picked|answered|contacted|called|discussed|done/.test(t)) return "CALLED_SPOKE";
  return null;
}
