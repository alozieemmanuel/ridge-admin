import type { Registration } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateTicketCode } from "@/lib/ticket";

/** Door staff can take back a check-in for this long. Owners and admins can always do it from the Attendance page. */
export const UNDO_WINDOW_MS = 5 * 60_000;

export interface GuestView {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  category: string;
  ticketCode: string | null;
  reserved: boolean;
  checkedInAt: string | null;
  checkedInBy: string | null;
  /** True while door staff may still undo this check-in. */
  canUndo: boolean;
}

export type CheckinState = "checked_in" | "already" | "not_reserved" | "not_found";

export function toView(r: Pick<Registration, "id" | "fullName" | "email" | "phone" | "categories" | "organization" | "ticketCode" | "reservedAt" | "checkedInAt" | "checkedInByName">, now = Date.now()): GuestView {
  const category = r.categories?.length ? r.categories.join(", ") : r.organization || "";
  return {
    id: r.id,
    fullName: r.fullName,
    email: r.email,
    phone: r.phone,
    category,
    ticketCode: r.ticketCode,
    reserved: Boolean(r.reservedAt),
    checkedInAt: r.checkedInAt ? r.checkedInAt.toISOString() : null,
    checkedInBy: r.checkedInByName ?? null,
    canUndo: Boolean(r.checkedInAt && now - r.checkedInAt.getTime() <= UNDO_WINDOW_MS),
  };
}

const SELECT = { id: true, fullName: true, email: true, phone: true, categories: true, organization: true, ticketCode: true, reservedAt: true, checkedInAt: true, checkedInByName: true } as const;

/** A scanner or a person may hand over the whole link (".../checkin?code=IH-ABC123") or just the code. */
export function cleanCode(raw: string): string {
  const t = (raw || "").trim();
  const m = /[?&]code=([^&#\s]+)/i.exec(t);
  let code = m ? m[1] : t;
  try {
    code = decodeURIComponent(code);
  } catch {
    // keep as is
  }
  return code.trim().toUpperCase().slice(0, 40);
}

export async function findByCode(eventId: string, raw: string) {
  const code = cleanCode(raw);
  if (!code) return null;
  return prisma.registration.findFirst({ where: { eventId, ticketCode: code }, select: SELECT });
}

/** Looks people up by email, phone, ticket code or name. Names can repeat, so every match is listed with its details. */
export async function searchGuests(eventId: string, q: string): Promise<GuestView[]> {
  const text = q.trim();
  if (text.length < 2) return [];
  const digits = text.replace(/\D/g, "");
  const or: object[] = [
    { email: { contains: text, mode: "insensitive" } },
    { fullName: { contains: text, mode: "insensitive" } },
    { ticketCode: { contains: cleanCode(text), mode: "insensitive" } },
  ];
  if (digits.length >= 4) or.push({ phone: { contains: digits } });
  const rows = await prisma.registration.findMany({ where: { eventId, OR: or }, select: SELECT, orderBy: [{ fullName: "asc" }], take: 25 });
  const now = Date.now();
  // People with a seat come first: they are the ones who can be checked in.
  return rows.map((r) => toView(r, now)).sort((a, b) => Number(b.reserved) - Number(a.reserved));
}

export async function recentCheckins(eventId: string, take = 6): Promise<GuestView[]> {
  const rows = await prisma.registration.findMany({ where: { eventId, checkedInAt: { not: null } }, select: SELECT, orderBy: { checkedInAt: "desc" }, take });
  const now = Date.now();
  return rows.map((r) => toView(r, now));
}

export async function checkinCounts(eventId: string): Promise<{ checkedIn: number; reserved: number }> {
  const [checkedIn, reserved] = await Promise.all([
    prisma.registration.count({ where: { eventId, checkedInAt: { not: null } } }),
    prisma.registration.count({ where: { eventId, reservedAt: { not: null } } }),
  ]);
  return { checkedIn, reserved };
}

/**
 * Checks one person in. The update only succeeds for a reserved guest who is not checked in yet, and it is a single statement,
 * so two officials scanning the same ticket at the same moment cannot both succeed: the second one sees "already".
 */
export async function checkInGuest(eventId: string, id: string, byName: string): Promise<{ state: CheckinState; guest: GuestView | null }> {
  const won = await prisma.registration.updateMany({
    where: { id, eventId, reservedAt: { not: null }, checkedInAt: null },
    data: { checkedInAt: new Date(), checkedInByName: byName },
  });
  const row = await prisma.registration.findFirst({ where: { id, eventId }, select: SELECT });
  if (!row) return { state: "not_found", guest: null };
  const guest = toView(row);
  if (won.count === 1) return { state: "checked_in", guest };
  return { state: row.reservedAt ? "already" : "not_reserved", guest };
}

/**
 * Checks in a guest who never reserved a seat (for example they did not see the invitation email) at the door. The guest is given a seat
 * and a ticket code and is marked as arrived in one statement, so two officials cannot do it twice. The seat limit is not applied: the
 * person is standing at the door, and the official decides. A guest who already has a seat is checked in the normal way.
 */
export async function walkInCheckIn(eventId: string, id: string, byName: string): Promise<{ state: CheckinState; guest: GuestView | null; walkIn: boolean }> {
  const row = await prisma.registration.findFirst({ where: { id, eventId }, select: SELECT });
  if (!row) return { state: "not_found", guest: null, walkIn: false };
  if (row.reservedAt) return { ...(await checkInGuest(eventId, id, byName)), walkIn: false };

  let code = generateTicketCode();
  for (let i = 0; i < 8 && (await prisma.registration.findUnique({ where: { ticketCode: code }, select: { id: true } })); i++) code = generateTicketCode();
  const now = new Date();
  const won = await prisma.registration.updateMany({
    where: { id, eventId, reservedAt: null, checkedInAt: null },
    data: { reservedAt: now, ticketCode: code, checkedInAt: now, checkedInByName: byName },
  });
  if (won.count !== 1) return { ...(await checkInGuest(eventId, id, byName)), walkIn: false };
  const after = await prisma.registration.findFirst({ where: { id, eventId }, select: SELECT });
  return { state: "checked_in", guest: after ? toView(after) : null, walkIn: true };
}

/** Takes a check-in back. Door staff only within the undo window; owners and admins any time. */
export async function undoCheckIn(eventId: string, id: string, doorStaff: boolean): Promise<{ ok: true; guest: GuestView } | { ok: false; error: string }> {
  const row = await prisma.registration.findFirst({ where: { id, eventId }, select: SELECT });
  if (!row) return { ok: false, error: "Guest not found." };
  if (!row.checkedInAt) return { ok: false, error: `${row.fullName} is not checked in.` };
  if (doorStaff && Date.now() - row.checkedInAt.getTime() > UNDO_WINDOW_MS) {
    return { ok: false, error: `It has been more than ${UNDO_WINDOW_MS / 60_000} minutes. Ask an admin to undo it.` };
  }
  await prisma.registration.updateMany({ where: { id, eventId }, data: { checkedInAt: null, checkedInByName: null } });
  const after = await prisma.registration.findFirst({ where: { id, eventId }, select: SELECT });
  return { ok: true, guest: toView(after!) };
}
