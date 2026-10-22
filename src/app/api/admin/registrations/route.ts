import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { FOLLOW_UP_VALUES, isFollowUpStatus } from "@/lib/followUp";

export const runtime = "nodejs";

/**
 * The guest list. Filters: search (name, email, phone, company), followUp (one status), seat
 * ("RESERVED" | "NOT_RESERVED"). Counts for the filter pills cover the whole list, whatever page or filter is on.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search")?.trim() || "";
  const followUp = searchParams.get("followUp");
  const seat = searchParams.get("seat");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10) || 50));

  const where: Prisma.RegistrationWhereInput = {
    AND: [
      search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { organization: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
      isFollowUpStatus(followUp) ? { followUpStatus: followUp } : {},
      seat === "RESERVED" ? { reservedAt: { not: null } } : seat === "NOT_RESERVED" ? { reservedAt: null } : {},
    ],
  };

  const [total, list, groups, reservedCount, allCount] = await Promise.all([
    prisma.registration.count({ where }),
    prisma.registration.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { fullName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        organization: true,
        followUpStatus: true,
        inviteSentAt: true,
        reservedAt: true,
        checkedInAt: true,
        createdAt: true,
      },
    }),
    prisma.registration.groupBy({ by: ["followUpStatus"], _count: { _all: true } }),
    prisma.registration.count({ where: { reservedAt: { not: null } } }),
    prisma.registration.count(),
  ]);

  const followUpCounts: Record<string, number> = Object.fromEntries(FOLLOW_UP_VALUES.map((v) => [v, 0]));
  for (const g of groups) followUpCounts[g.followUpStatus] = (followUpCounts[g.followUpStatus] ?? 0) + g._count._all;

  return NextResponse.json({
    registrations: list.map((r) => ({
      ...r,
      inviteSentAt: r.inviteSentAt?.toISOString() ?? null,
      reservedAt: r.reservedAt?.toISOString() ?? null,
      checkedInAt: r.checkedInAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    counts: { all: allCount, reserved: reservedCount, notReserved: allCount - reservedCount, followUp: followUpCounts },
  });
}
