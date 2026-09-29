import { prisma } from "@/lib/prisma";
import { audienceWhere } from "@/lib/campaigns";
import { normalizePhone } from "@/lib/whatsapp";
import type { CampaignAudience } from "@prisma/client";

export type WhatsAppAudience =
  | CampaignAudience
  | "PROSPECTS_ALL"
  | "PROSPECTS_NOT_REGISTERED"
  | "PROSPECTS_FOLLOW_UP";

export const WHATSAPP_AUDIENCE_LABELS: Record<WhatsAppAudience, string> = {
  ALL: "All registrants",
  EARLY_BIRD: "Early Bird",
  LATE: "Late",
  NOT_PAID: "Not paid",
  PARTIAL: "Partially paid",
  PAID: "Fully paid",
  CHECKED_IN: "Checked in (Day 7)",
  NOT_CHECKED_IN: "Not checked in (Day 7)",
  PROSPECTS_ALL: "All prospects",
  PROSPECTS_NOT_REGISTERED: "Prospects not yet registered",
  PROSPECTS_FOLLOW_UP: "Prospects needing follow-up",
};

export interface BroadcastRecipient {
  /** digits-only international number, or null if the saved number is unusable */
  waId: string | null;
  fullName: string;
  rawPhone: string | null;
}

/** People in an audience, one entry per phone number (duplicates collapsed). Unusable numbers are kept with waId null so they can be counted. */
export async function resolveWhatsAppAudience(audience: WhatsAppAudience): Promise<BroadcastRecipient[]> {
  let people: { fullName: string; phone: string | null }[];

  if (audience === "PROSPECTS_ALL") {
    people = await prisma.prospect.findMany({ select: { fullName: true, phone: true } });
  } else if (audience === "PROSPECTS_NOT_REGISTERED") {
    people = await prisma.prospect.findMany({ where: { registrationId: null }, select: { fullName: true, phone: true } });
  } else if (audience === "PROSPECTS_FOLLOW_UP") {
    people = await prisma.prospect.findMany({
      where: { followUpRequired: true, registrationId: null },
      select: { fullName: true, phone: true },
    });
  } else {
    people = await prisma.registration.findMany({ where: audienceWhere(audience), select: { fullName: true, phone: true } });
  }

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

export async function whatsappAudienceCounts(): Promise<Record<WhatsAppAudience, number>> {
  const entries = await Promise.all(
    (Object.keys(WHATSAPP_AUDIENCE_LABELS) as WhatsAppAudience[]).map(async (a) => {
      const recipients = await resolveWhatsAppAudience(a);
      return [a, recipients.filter((r) => r.waId).length] as const;
    })
  );
  return Object.fromEntries(entries) as Record<WhatsAppAudience, number>;
}
