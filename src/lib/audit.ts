import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/auth";
import { eventIdForSlug } from "@/lib/event";

/**
 * Every action name written to the audit log. Grouped by the part before the
 * dot, which is what the Audit Log page's category filter matches on.
 */
export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "registration.payment_update"
  | "registration.payment_reset"
  | "registration.resend_confirmation"
  | "registration.send_seat_invite"
  | "registration.send_payment_reminder"
  | "registration.checkin"
  | "registration.delete"
  | "registration.export"
  | "participants.import"
  | "contacts.sheet_link"
  | "contacts.sheet_sync"
  | "participant.update"
  | "participant.note"
  | "participant.note_delete"
  | "participant.follow_up"
  | "participant.send_invitation"
  | "participant.send_ticket"
  | "participant.reserve"
  | "participant.release"
  | "attendance.capacity"
  | "payment_proof.reject"
  | "brochure.delete"
  | "campaign.send"
  | "campaign.test"
  | "event.create"
  | "event.update"
  | "event.access"
  | "campaign.delete"
  | "reply.send"
  | "seat.update"
  | "template.update"
  | "settings.update"
  | "admin.create"
  | "admin.delete"
  | "admin.update"
  | "admin.password_change"
  | "admin.archive"
  | "admin.restore"
  | "prospect.update"
  | "prospect.convert"
  | "prospect.source_create"
  | "prospect.source_update"
  | "prospect.source_delete"
  | "whatsapp.send"
  | "whatsapp.broadcast"
  | "data.clear";

export interface AuditEntry {
  action: AuditAction;
  entityType?:
    | "payment_proof"
    | "registration"
    | "brochure_request"
    | "campaign"
    | "seat"
    | "template"
    | "admin"
    | "reply"
    | "prospect"
    | "prospect_source"
    | "whatsapp"
    | "whatsapp_broadcast"
    | "event"
    | "data";
  /** The event this belongs to. Left out, it is taken from the request's event (x-event header); team-wide actions have none. */
  eventId?: string | null;
  entityId?: string;
  /** Human-readable label, e.g. the participant's name, so the log reads without joins. */
  entityLabel?: string;
  details?: Prisma.InputJsonValue;
}

export interface AuditActor {
  adminId?: string | null;
  name: string;
  email?: string | null;
}

export function actorFromSession(session: SessionPayload | null): AuditActor {
  return session
    ? { adminId: session.adminId, name: session.name, email: session.email }
    : { adminId: null, name: "Unknown admin", email: null };
}

function clientIp(request?: Request): string | null {
  const forwarded = request?.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || null;
  return request?.headers.get("x-real-ip") ?? null;
}

/**
 * Records one admin action. Best-effort by design: a failure to write the audit
 * row is logged but never blocks or fails the action being audited.
 */
export async function logAudit(actor: AuditActor, entry: AuditEntry, request?: Request): Promise<void> {
  try {
    let eventId = entry.eventId;
    if (eventId === undefined && request) {
      const slug = (request.headers.get("x-event") || new URL(request.url).searchParams.get("event") || "").trim().toLowerCase();
      eventId = slug ? await eventIdForSlug(slug) : null;
    }
    await prisma.auditLog.create({
      data: {
        eventId: eventId ?? null,
        adminId: actor.adminId ?? null,
        adminName: actor.name,
        adminEmail: actor.email ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        entityLabel: entry.entityLabel,
        details: entry.details,
        ipAddress: clientIp(request),
      },
    });
  } catch (err) {
    console.error("[audit] Could not write audit log entry:", entry.action, err);
  }
}

/** Convenience wrapper for the common case of auditing as the signed-in admin. */
export async function logAdminAction(session: SessionPayload | null, entry: AuditEntry, request?: Request) {
  return logAudit(actorFromSession(session), entry, request);
}