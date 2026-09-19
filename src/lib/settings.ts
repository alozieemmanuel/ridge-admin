import { prisma } from "@/lib/prisma";

// These mirror the CONFIG block from the original code.gs. They're seeded once
// (see prisma/seed.ts) and from then on live in the Setting table, editable
// from /admin/settings — no redeploy needed to change dates, fees, or bank
// details ever again.
export const DEFAULT_SETTINGS: Record<string, string> = {
  programme_name: "RIDGE — Executive Wealth Creation Programme",
  event_caption: "Executive Wealth Creation Programme",
  cohort_dates: "8–14 November 2026",
  sender_name: "RIDGE 2026",
  registration_fee: "USD $2,000 (Early Bird)",
  late_registration_fee: "USD $5,000",
  // Plain numbers (no currency symbol/commas) used to auto-derive a
  // registration's payment status when an admin confirms an amount paid.
  registration_fee_amount: "2000",
  late_registration_fee_amount: "5000",
  early_bird_deadline: "10th October 2026",
  brochure_url: "https://pertinencegroup.com/ridge/RIDGE-Brochure-2026.pdf",
  payment_account_name: "PERTINENCE PROPERTIES LIMITED",
  payment_bank_name: "ZENITH BANK",
  payment_account_number: "5076183938",
  currency: "USD",
  contact_email: "ridge@pertinencegroup.com",
  notification_email: "ridge@pertinencegroup.com",
  contact_whatsapp_number: "2348149774237",
  contact_whatsapp_message: "Hi RIDGE team, I'd like some help with my registration.",
  // Placeholder until the public seat-picker page exists — the registration
  // id is appended as a query param when the invite email is sent.
  seat_selection_url: "https://theridgecircle.com/select-seat",
};

export async function getSettingsMap(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

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
