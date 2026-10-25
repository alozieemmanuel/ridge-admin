/** The optional parts of an event that can be switched on. Contacts and Settings are always on. Safe for client code. */
export const EVENT_MODULES = [
  { key: "invitations", label: "Invitations, seat reservation and tickets", hint: "Unique reserve link per guest, seat limit and emailed ticket." },
  { key: "attendance", label: "Attendance and check-in", hint: "Check-in screen and QR ticket scanning for the day." },
  { key: "campaigns", label: "Campaign emails", hint: "Bulk email to the event's contacts." },
] as const;
export type ModuleKey = (typeof EVENT_MODULES)[number]["key"] | "whatsapp";
export const MODULE_KEYS: string[] = EVENT_MODULES.map((m) => m.key);
