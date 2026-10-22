import { followUpLabel } from "@/lib/followUp";

export interface ActivityItem {
  id: string;
  /** What happened, in one short line. */
  title: string;
  /** Extra detail (the note, the error, the old and new values). */
  detail: string | null;
  /** Who did it: an admin's name, "Guest" or "System". */
  by: string;
  at: string;
  tone: "normal" | "good" | "bad";
}

interface AuditRow {
  id: string;
  adminName: string;
  action: string;
  details: unknown;
  createdAt: Date;
}

const FIELD_LABELS: Record<string, string> = { fullName: "name", email: "email address", phone: "phone number" };

/** Turns one activity-log row about a guest into the sentence shown on their page. Returns null for rows that are not worth showing. */
export function describeActivity(row: AuditRow): ActivityItem | null {
  const d = (row.details ?? {}) as Record<string, unknown>;
  const failed = d.outcome === "failed";
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  let title: string;
  let detail: string | null = null;
  let tone: ActivityItem["tone"] = "normal";

  switch (row.action) {
    case "participant.send_invitation": {
      const reminder = d.kind === "reminder";
      title = failed ? `${reminder ? "Reminder" : "Invitation"} email failed` : `${reminder ? "Reminder" : "Invitation"} emailed`;
      detail = failed ? text(d.error) : text(d.to);
      tone = failed ? "bad" : "normal";
      break;
    }
    case "participant.send_ticket":
      title = failed ? "Ticket email failed" : "Ticket emailed";
      detail = failed ? text(d.error) : text(d.to);
      tone = failed ? "bad" : "normal";
      break;
    case "participant.reserve":
      title = d.by === "guest" ? "Reserved their own seat" : "Seat reserved by the team";
      tone = "good";
      break;
    case "participant.release":
      title = "Reservation cancelled";
      break;
    case "registration.checkin":
      title = d.checkedIn ? "Checked in at the event" : "Check-in undone";
      tone = d.checkedIn ? "good" : "normal";
      break;
    case "participant.update": {
      const changes = Array.isArray(d.changes) ? (d.changes as { field: string; from: string; to: string }[]) : [];
      title = "Details edited";
      detail = changes.length
        ? changes.map((c) => `${FIELD_LABELS[c.field] ?? c.field}: ${c.from || "empty"} → ${c.to || "empty"}`).join("\n")
        : null;
      break;
    }
    case "participant.follow_up":
      title = `Follow-up: ${followUpLabel(text(d.to))}`;
      detail = text(d.feedback);
      break;
    case "participant.note_delete":
      title = "Follow-up entry deleted";
      detail = text(d.feedback);
      break;
    default:
      return null;
  }
  return { id: row.id, title, detail, by: row.adminName, at: row.createdAt.toISOString(), tone };
}
