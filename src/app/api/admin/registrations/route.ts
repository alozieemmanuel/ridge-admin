import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { FOLLOW_UP_VALUES, isFollowUpStatus } from "@/lib/followUp";
import { requireEvent } from "@/lib/event";

export const runtime = "nodejs";

/**
 * The event's contact list. Filters: search (name, email, phone), followUp (one status, or "CONTACTED" for anyone already called), seat
 * ("RESERVED" | "NOT_RESERVED" | "INVITED" | "AWAITING" | "NOT_INVITED"). Counts for the filter pills cover the whole list, whatever page or filter is on.
 */
const INVITED: Prisma.RegistrationWhereInput = { OR: [{ inviteSentAt: { not: null } }, { reservedAt: { not: null } }] };

function seatFilter(seat: string | null): Prisma.RegistrationWhereInput {
  switch (seat) {
    case "RESERVED":
      return { reservedAt: { not: null } };
    case "NOT_RESERVED":
      return { reservedAt: null };
    case "INVITED": // an invitation went out (including those who already reserved)
      return INVITED;
    case "AWAITING": // invited, no reply yet
      return { inviteSentAt: { not: null }, reservedAt: null };
    case "NOT_INVITED":
      return { inviteSentAt: null, reservedAt: null };
    default:
      return {};
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const { event } = ctx;
  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search")?.trim() || "";
  const followUp = searchParams.get("followUp");
  const seat = searchParams.get("seat");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10) || 50));

  const where: Prisma.RegistrationWhereInput = {
    AND: [
      { eventId: event.id },
      search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
            ],
          }
        : {},
      isFollowUpStatus(followUp) ? { followUpStatus: followUp } : followUp === "CONTACTED" ? { followUpStatus: { not: "NOT_CONTACTED" } } : {},
      seatFilter(seat),
    ],
  };

  const [total, list, groups] = await Promise.all([
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
        followUpStatus: true,
        inviteSentAt: true,
        reservedAt: true,
        checkedInAt: true,
        createdAt: true,
      },
    }),
    // One grouped query gives the counts for the filter pills (everyone, reserved, and per follow-up status).
    prisma.$queryRaw<{ s: string; n: number; reserved: number }[]>`
      SELECT "followUpStatus" AS s, count(*)::int AS n, count("reservedAt")::int AS reserved FROM "Registration" WHERE "eventId" = ${event.id} GROUP BY "followUpStatus"`,
  ]);
  const allCount = groups.reduce((n, g) => n + g.n, 0);
  const reservedCount = groups.reduce((n, g) => n + g.reserved, 0);

  const followUpCounts: Record<string, number> = Object.fromEntries(FOLLOW_UP_VALUES.map((v) => [v, 0]));
  for (const g of groups) followUpCounts[g.s] = (followUpCounts[g.s] ?? 0) + g.n;

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
