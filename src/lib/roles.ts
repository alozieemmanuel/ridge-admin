/**
 * The three roles of the dashboard. Safe for both server and client code.
 *
 *   OWNER        everything, including the technical details (keys, addresses, setup code).
 *   SUPER_ADMIN  everything an owner can do with events, contacts, emails and the team, but the technical details are hidden.
 *                Cannot create, change or remove owners or other super admins.
 *   ADMIN        only the events they were added to.
 *   CHECKIN      door staff: only the check-in page of the events they were added to, nothing else.
 */
export type Role = "OWNER" | "SUPER_ADMIN" | "ADMIN" | "CHECKIN";

export const ROLE_LABEL: Record<Role, string> = { OWNER: "Owner", SUPER_ADMIN: "Super admin", ADMIN: "Admin", CHECKIN: "Check-in only" };

export function isRole(value: unknown): value is Role {
  return value === "OWNER" || value === "SUPER_ADMIN" || value === "ADMIN" || value === "CHECKIN";
}

/** Owner and super admin: all events, and the controls that used to be "owner only". */
export function isPower(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "SUPER_ADMIN";
}

/** Roles that only see the events they were added to. */
export function isEventScoped(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "CHECKIN";
}

/** Door staff: the check-in page and nothing else. */
export function isCheckinOnly(role: string | null | undefined): boolean {
  return role === "CHECKIN";
}

/** Only the owner sees keys, private addresses, setup code and environment names. */
export function isTechnical(role: string | null | undefined): boolean {
  return role === "OWNER";
}

/** Whether `actor` may create, change or remove an account that has (or will get) these roles. */
export function canManage(actor: string, ...roles: (string | undefined)[]): boolean {
  if (actor === "OWNER") return true;
  if (actor === "SUPER_ADMIN") return roles.every((r) => r === undefined || r === "ADMIN" || r === "CHECKIN");
  return false;
}
