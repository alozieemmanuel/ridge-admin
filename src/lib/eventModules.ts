/** The optional parts of an event that can be switched on. Contacts and Settings are always on. Safe for client code. */
export const EVENT_MODULES = [
  { key: "invitations", label: "Invitations, seat reservation and tickets", hint: "Unique reserve link per guest, seat limit and emailed ticket." },
  { key: "attendance", label: "Attendance and check-in", hint: "Check-in screen and QR ticket scanning for the day." },
  { key: "campaigns", label: "Campaign emails", hint: "Bulk email to the event's contacts." },
  { key: "tests", label: "Tests", hint: "Online test for checked-in guests, with a question bank, random papers and score-based rewards." },
  { key: "whatsapp", label: "WhatsApp messages", hint: "Broadcast and one-to-one messages, with the replies in one inbox." },
] as const;
export type ModuleKey = (typeof EVENT_MODULES)[number]["key"];
export const MODULE_KEYS: string[] = EVENT_MODULES.map((m) => m.key);
