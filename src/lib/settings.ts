import { prisma } from "@/lib/prisma";

// Business-config values for the event. They are seeded once (see prisma/seed.ts) and from then on
// live in the Setting table, editable from /admin/settings, so a date, venue or seat limit can be
// changed without a redeploy. Every key is also available in email templates as {{key}}.
export const DEFAULT_SETTINGS: Record<string, string> = {
  programme_name: "Investor Breakfast Hangout",
  event_caption: "By invitation only",
  sender_name: "Investor Hangout",
  // Shown on invitations, tickets and the reserve page. Invitations are blocked until the date and venue are set.
  event_date: "",
  event_time: "",
  event_venue: "",
  // How many seats can be reserved. A reservation is refused once this many are taken. Empty = no limit.
  seat_capacity: "100",
  // Where guests are told to send questions (shown on the reserve page and in emails). Also the default Reply-To.
  contact_email: "",
  contact_phone: "",
};

export async function getSettingsMap(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

/** Used only by the switched-off registration/WhatsApp emails (see src/lib/modules.ts). */
export function buildWhatsAppUrl(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/**
 * Replaces {{token}} placeholders in a string with values from the provided
 * map(s). Later maps override earlier ones. Unknown tokens are left as-is
 * rather than silently blanked, so a typo'd token is easy to spot in a sent
 * email rather than disappearing invisibly.
 */
export function mergeTemplate(text: string, ...maps: Record<string, string | undefined>[]): string {
  const combined: Record<string, string | undefined> = Object.assign({}, ...maps);
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, token) => {
    const value = combined[token];
    return value !== undefined && value !== null ? value : match;
  });
}
