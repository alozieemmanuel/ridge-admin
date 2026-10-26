import { prisma } from "@/lib/prisma";
import { brandOf } from "@/lib/eventBrand";
import { formatPrice, paymentFrom, paymentInstructions } from "@/lib/payments";

// Business-config values for an event. Each event has its own set, stored in the Setting table (editable from the
// event's Settings page), so a date, venue or seat limit can be changed without a redeploy. Any value an event has not
// set uses the default below. Every key is also available in email templates as {{key}}.
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

/**
 * One event's settings: the defaults, overridden by what the event saved. Also holds event_slug and event_name
 * (the event's address and name), so the emails and reserve links can use them.
 */
export async function getSettingsMap(eventId: string): Promise<Record<string, string>> {
  const [event, rows] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { slug: true, name: true, type: true, brandName: true, color: true, logoUrl: true, logoDarkUrl: true, timezone: true } }),
    prisma.setting.findMany({ where: { eventId } }),
  ]);
  const map: Record<string, string> = { ...DEFAULT_SETTINGS, programme_name: event?.name ?? DEFAULT_SETTINGS.programme_name };
  for (const row of rows) {
    map[row.key] = row.value;
  }
  map.event_id = eventId;
  map.event_slug = event?.slug ?? "";
  map.event_name = event?.name ?? map.programme_name;
  if (event) {
    const brand = brandOf(event);
    map.event_brand_name = brand.name;
    map.event_color = event.color ?? "";
    map.event_logo_url = brand.hasOwnLogo ? brand.logoUrl : "";
    map.event_timezone = event.timezone;
    // Paid events: {{ticket_price}} and {{payment_instructions}} can be used in any email template.
    if (event.type === "paid") {
      const pay = paymentFrom(map);
      map.ticket_price = pay.price ? formatPrice(pay.price, pay.currency) : "";
      map.payment_instructions = paymentInstructions(pay);
    }
  }
  return map;
}

/** Saves one setting for one event. */
export async function saveSetting(eventId: string, key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { eventId_key: { eventId, key } }, update: { value }, create: { eventId, key, value } });
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
