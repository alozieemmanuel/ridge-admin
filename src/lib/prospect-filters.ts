import { interpretStatus, normalizeHeader } from "@/lib/prospect-columns";
import { parseScheduleDay } from "@/lib/schedule";

/** The few fields the filters and counters need. */
export interface ProspectLite {
  sourceId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  callRequested: string | null;
  callSchedule: string | null;
  callCompleted: boolean;
  followUpRequired: boolean;
  registrationId: string | null;
}

export type ProspectFilter =
  | "ALL"
  | "CALL_REQUESTED"
  | "TO_CALL"
  | "DUE_TODAY"
  | "CALL_DONE"
  | "TEXT_SENT"
  | "FOLLOW_UP"
  | "CONVERTED";

export const PROSPECT_FILTERS: ProspectFilter[] = [
  "ALL",
  "CALL_REQUESTED",
  "TO_CALL",
  "DUE_TODAY",
  "CALL_DONE",
  "TEXT_SENT",
  "FOLLOW_UP",
  "CONVERTED",
];

export function isYes(value: string | null): boolean {
  const status = interpretStatus(value);
  if (status) return status.requested;
  return ["yes", "y", "true", "requested"].includes((value ?? "").trim().toLowerCase());
}

export function isTextSent(p: Pick<ProspectLite, "callRequested">): boolean {
  return normalizeHeader(p.callRequested ?? "") === "textsent";
}

export function isNotInterested(p: Pick<ProspectLite, "callRequested">): boolean {
  return normalizeHeader(p.callRequested ?? "") === "notinterested";
}

/** True when this person still has a call to make (a first call or a follow-up). */
export function needsCall(p: ProspectLite): boolean {
  return !p.registrationId && !isNotInterested(p) && (!p.callCompleted || p.followUpRequired);
}

/** `today` is "YYYY-MM-DD" on the admin's own clock. */
export function matchesFilter(p: ProspectLite, filter: ProspectFilter, today: string): boolean {
  switch (filter) {
    case "CALL_REQUESTED":
      return isYes(p.callRequested);
    case "TO_CALL":
      return !p.callCompleted && isYes(p.callRequested);
    case "DUE_TODAY":
      return needsCall(p) && parseScheduleDay(p.callSchedule) === today;
    case "CALL_DONE":
      return p.callCompleted;
    case "TEXT_SENT":
      return isTextSent(p);
    case "FOLLOW_UP":
      return p.followUpRequired;
    case "CONVERTED":
      return Boolean(p.registrationId);
    default:
      return true;
  }
}

export function matchesSearch(p: ProspectLite, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.fullName, p.email, p.phone].some((v) => (v ?? "").toLowerCase().includes(q));
}

export interface ProspectStats {
  completed: number;
  requested: number;
  textSent: number;
  followUp: number;
  dueToday: number;
  doneToday: number;
  overdue: number;
  unscheduled: number;
}

export function computeStats(pool: ProspectLite[], today: string): ProspectStats {
  const s: ProspectStats = { completed: 0, requested: 0, textSent: 0, followUp: 0, dueToday: 0, doneToday: 0, overdue: 0, unscheduled: 0 };
  for (const p of pool) {
    if (p.callCompleted) s.completed++;
    if (isYes(p.callRequested)) s.requested++;
    if (isTextSent(p)) s.textSent++;
    if (p.followUpRequired) s.followUp++;

    if (p.registrationId || isNotInterested(p)) continue;
    const day = parseScheduleDay(p.callSchedule);
    if (day === today) {
      if (needsCall(p)) s.dueToday++;
      else s.doneToday++;
    } else if (needsCall(p) && isYes(p.callRequested)) {
      if (day === null) s.unscheduled++;
      else if (day < today) s.overdue++;
    }
  }
  return s;
}
