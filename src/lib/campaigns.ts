import type { Prisma, CampaignAudience } from "@prisma/client";

export const AUDIENCE_LABELS: Record<CampaignAudience, string> = {
  ALL: "All registrants",
  EARLY_BIRD: "Early Bird",
  LATE: "Late",
  NOT_PAID: "Not paid",
  PARTIAL: "Partially paid",
  PAID: "Fully paid",
  CHECKED_IN: "Checked in (Day 7)",
  NOT_CHECKED_IN: "Not checked in (Day 7)",
};

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
  }
}
