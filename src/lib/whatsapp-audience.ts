import { prisma } from "@/lib/prisma";
import { audienceWhere } from "@/lib/campaigns";
import { normalizePhone } from "@/lib/whatsapp";
import type { CampaignAudience } from "@prisma/client";

/** Who an event's WhatsApp broadcast can go to. The same groups as the event's email campaigns. */
export type WhatsAppAudience = CampaignAudience;

export const WHATSAPP_AUDIENCE_LABELS: Partial<Record<WhatsAppAudience, string>> = {
  ALL: "Everyone",
  NOT_INVITED: "Not invited yet",
  INVITED_NOT_RESERVED: "Invited, not reserved",
  RESERVED: "Seat reserved",
  CHECKED_IN: "Checked in",
  NOT_CHECKED_IN: "Not checked in",
};

export const WHATSAPP_AUDIENCE_KEYS = Object.keys(WHATSAPP_AUDIENCE_LABELS) as WhatsAppAudience[];

export interface BroadcastRecipient {
  /** digits-only international number, or null if the saved number is unusable */
  waId: string | null;
  fullName: string;
  rawPhone: string | null;
}

/**
 * People of one event in an audience, one entry per phone number (duplicates collapsed). Unusable numbers are kept with
 * waId null so they can be counted.
 */
export async function resolveWhatsAppAudience(eventId: string, audience: WhatsAppAudience, category?: string | null): Promise<BroadcastRecipient[]> {
  const people = await prisma.registration.findMany({ where: { AND: [{ eventId }, audienceWhere(audience, category)] }, select: { fullName: true, phone: true } });

  const seen = new Set<string>();
  const out: BroadcastRecipient[] = [];
  for (const p of people) {
    const waId = normalizePhone(p.phone);
    if (waId) {
      if (seen.has(waId)) continue;
      seen.add(waId);
    }
    out.push({ waId, fullName: p.fullName, rawPhone: p.phone });
  }
  return out;
}

export async function whatsappAudienceCounts(eventId: string, category?: string | null): Promise<Record<string, number>> {
  const entries = await Promise.all(
    WHATSAPP_AUDIENCE_KEYS.map(async (a) => {
      const recipients = await resolveWhatsAppAudience(eventId, a, category);
      return [a, recipients.filter((r) => r.waId).length] as const;
    })
  );
  return Object.fromEntries(entries);
}
