import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CATEGORY_VALUES, isCategory } from "@/lib/categories";
import type { CampaignAudience } from "@prisma/client";

export const runtime = "nodejs";

const AUDIENCES: CampaignAudience[] = [
  "ALL",
  "EARLY_BIRD",
  "LATE",
  "NOT_PAID",
  "PARTIAL",
  "PAID",
  "CHECKED_IN",
  "NOT_CHECKED_IN",
];

interface Person {
  regType: "EARLY_BIRD" | "LATE";
  paymentStatus: "NOT_PAID" | "PARTIAL" | "PAID";
  checkedIn: boolean;
  categories: string[];
}

/** Same rules as audienceWhere() in src/lib/campaigns.ts, applied in memory. */
function inAudience(p: Person, audience: CampaignAudience): boolean {
  switch (audience) {
    case "ALL":
      return true;
    case "EARLY_BIRD":
      return p.regType === "EARLY_BIRD";
    case "LATE":
      return p.regType === "LATE";
    case "NOT_PAID":
      return p.paymentStatus === "NOT_PAID";
    case "PARTIAL":
      return p.paymentStatus === "PARTIAL";
    case "PAID":
      return p.paymentStatus === "PAID";
    case "CHECKED_IN":
      return p.checkedIn;
    case "NOT_CHECKED_IN":
      return !p.checkedIn;
  }
}

/**
 * `counts`: how many people each audience has, within the selected category (if any).
 * `categoryCounts`: how many people each category has, within the selected audience.
 *
 * Everyone is read with ONE query and counted here, because the database pool may only
 * allow a single connection (connection_limit=1) and a dozen parallel counts would time out.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const categoryParam = searchParams.get("category");
  const category = isCategory(categoryParam) ? categoryParam : null;
  const audienceParam = searchParams.get("audience") as CampaignAudience | null;
  const audience: CampaignAudience = audienceParam && AUDIENCES.includes(audienceParam) ? audienceParam : "ALL";

  const rows = await prisma.registration.findMany({
    select: { regType: true, paymentStatus: true, checkedInAt: true, categories: true },
  });
  const people: Person[] = rows.map((r) => ({
    regType: r.regType,
    paymentStatus: r.paymentStatus,
    checkedIn: r.checkedInAt !== null,
    categories: r.categories,
  }));

  const counts: Record<string, number> = {};
  for (const a of AUDIENCES) {
    counts[a] = people.filter((p) => inAudience(p, a) && (!category || p.categories.includes(category))).length;
  }
  const categoryCounts: Record<string, number> = {};
  for (const c of CATEGORY_VALUES) {
    categoryCounts[c] = people.filter((p) => inAudience(p, audience) && p.categories.includes(c)).length;
  }
  return NextResponse.json({ counts, categoryCounts });
}
