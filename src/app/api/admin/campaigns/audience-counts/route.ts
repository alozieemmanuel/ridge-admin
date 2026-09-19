import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audienceWhere } from "@/lib/campaigns";
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

export async function GET() {
  const counts = await Promise.all(
    AUDIENCES.map((a) => prisma.registration.count({ where: audienceWhere(a) }))
  );
  const result: Record<string, number> = {};
  AUDIENCES.forEach((a, i) => (result[a] = counts[i]));
  return NextResponse.json({ counts: result });
}
