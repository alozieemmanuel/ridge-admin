import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CATEGORY_VALUES, isCategory } from "@/lib/categories";
import { CAMPAIGN_AUDIENCES } from "@/lib/campaigns";
import type { CampaignAudience } from "@prisma/client";
import { requireEvent } from "@/lib/event";

export const runtime = "nodejs";

const AUDIENCES: CampaignAudience[] = CAMPAIGN_AUDIENCES;

interface Person {
  invited: boolean;
  reserved: boolean;
  checkedIn: boolean;
  categories: string[];
}

/** Same rules as audienceWhere() in src/lib/campaigns.ts, applied in memory. */
function inAudience(p: Person, audience: CampaignAudience): boolean {
  switch (audience) {
    case "ALL":
      return true;
    case "NOT_INVITED":
      return !p.invited && !p.reserved;
    case "INVITED_NOT_RESERVED":
      return p.invited && !p.reserved;
    case "RESERVED":
      return p.reserved;
    case "CHECKED_IN":
      return p.checkedIn;
    case "NOT_CHECKED_IN":
      return !p.checkedIn;
    default:
      return false;
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
  const ctx = await requireEvent(request, { module: "campaigns" });
  if (!ctx.ok) return ctx.response;
  const { event } = ctx;
  const { searchParams } = request.nextUrl;
  const categoryParam = searchParams.get("category");
  const category = isCategory(categoryParam) ? categoryParam : null;
  const audienceParam = searchParams.get("audience") as CampaignAudience | null;
  const audience: CampaignAudience = audienceParam && AUDIENCES.includes(audienceParam) ? audienceParam : "ALL";

  const rows = await prisma.registration.findMany({
    where: { eventId: event.id, email: { not: "" } },
    select: { inviteSentAt: true, reservedAt: true, checkedInAt: true, categories: true },
  });
  const people: Person[] = rows.map((r) => ({
    invited: r.inviteSentAt !== null,
    reserved: r.reservedAt !== null,
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
