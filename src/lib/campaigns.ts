import type { Prisma, CampaignAudience } from "@prisma/client";

export const AUDIENCE_LABELS: Record<CampaignAudience, string> = {
  ALL: "Everyone",
  NOT_INVITED: "Not invited yet",
  INVITED_NOT_RESERVED: "Invited, not reserved",
  RESERVED: "Seat reserved",
  CHECKED_IN: "Checked in",
  NOT_CHECKED_IN: "Not checked in",
  // Kept so campaigns sent before the repurposing still read correctly in the history.
  EARLY_BIRD: "Early Bird",
  LATE: "Late",
  NOT_PAID: "Not paid",
  PARTIAL: "Partially paid",
  PAID: "Fully paid",
};

/** The audiences offered when composing a campaign, in display order. */
export const CAMPAIGN_AUDIENCES: CampaignAudience[] = [
  "ALL",
  "NOT_INVITED",
  "INVITED_NOT_RESERVED",
  "RESERVED",
  "CHECKED_IN",
  "NOT_CHECKED_IN",
];

/** The audience, optionally narrowed to one register page category ("What best describes you?"). */
export function audienceWhere(audience: CampaignAudience, category?: string | null): Prisma.RegistrationWhereInput {
  const base = audienceBaseWhere(audience);
  return category ? { AND: [base, { categories: { has: category } }] } : base;
}

function audienceBaseWhere(audience: CampaignAudience): Prisma.RegistrationWhereInput {
  switch (audience) {
    case "ALL":
      return {};
    case "EARLY_BIRD":
      return { regType: "EARLY_BIRD" };
    case "LATE":
      return { regType: "LATE" };
    case "NOT_PAID":
      return { paymentStatus: "NOT_PAID" };
    case "PARTIAL":
      return { paymentStatus: "PARTIAL" };
    case "PAID":
      return { paymentStatus: "PAID" };
    case "CHECKED_IN":
      return { checkedInAt: { not: null } };
    case "NOT_CHECKED_IN":
      return { checkedInAt: null };
    case "NOT_INVITED":
      return { inviteSentAt: null, reservedAt: null };
    case "INVITED_NOT_RESERVED":
      return { inviteSentAt: { not: null }, reservedAt: null };
    case "RESERVED":
      return { reservedAt: { not: null } };
  }
}
