import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { FOLLOW_UP_VALUES } from "@/lib/followUp";
import { getCapacity } from "@/lib/reservations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

interface Agg {
  s: string;
  n: number;
  reserved: number;
  checked: number;
  invited: number;
}

/** Everything the Overview page shows. Five queries run side by side (the big counts are one grouped query), so the page doesn't wait on a long chain of round trips. */
export async function GET() {
  const [capacity, agg, feedback, recent, reservedDates] = await Promise.all([
    getCapacity(),
    prisma.$queryRaw<Agg[]>`
      SELECT "followUpStatus" AS s,
             count(*)::int AS n,
             count("reservedAt")::int AS reserved,
             count("checkedInAt")::int AS checked,
             (count(*) FILTER (WHERE "inviteSentAt" IS NOT NULL OR "reservedAt" IS NOT NULL))::int AS invited
      FROM "Registration"
      GROUP BY "followUpStatus"`,
    prisma.$queryRaw<{ n: number }[]>`SELECT count(DISTINCT "registrationId")::int AS n FROM "FollowUpNote" WHERE body <> ''`,
    prisma.registration.findMany({
      where: { reservedAt: { not: null } },
      orderBy: { reservedAt: "desc" },
      take: 6,
      select: { id: true, fullName: true, reservedAt: true },
    }),
    prisma.registration.findMany({ where: { reservedAt: { gte: new Date(Date.now() - 14 * DAY) } }, select: { reservedAt: true } }),
  ]);

  const total = agg.reduce((n, g) => n + g.n, 0);
  const invited = agg.reduce((n, g) => n + g.invited, 0);
  const reserved = agg.reduce((n, g) => n + g.reserved, 0);
  const checkedIn = agg.reduce((n, g) => n + g.checked, 0);
  const withFeedback = feedback[0]?.n ?? 0;
  const groups = agg.map((g) => ({ followUpStatus: g.s, _count: { _all: g.n } }));

  const followUp: Record<string, number> = Object.fromEntries(FOLLOW_UP_VALUES.map((v) => [v, 0]));
  for (const g of groups) followUp[g.followUpStatus] = g._count._all;
  const contacted = total - (followUp.NOT_CONTACTED ?? 0);

  // Reservations per day for the last 14 days (the admin's browser labels the days; these keys are UTC dates).
  const perDay: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) perDay[new Date(Date.now() - i * DAY).toISOString().slice(0, 10)] = 0;
  for (const r of reservedDates) {
    const k = r.reservedAt!.toISOString().slice(0, 10);
    if (k in perDay) perDay[k]++;
  }

  return NextResponse.json({
    total,
    invited,
    notInvited: total - invited,
    awaitingReply: Math.max(0, invited - reserved),
    reserved,
    checkedIn,
    capacity,
    seatsLeft: capacity === null ? null : Math.max(0, capacity - reserved),
    contacted,
    followUp,
    withFeedback,
    recentReservations: recent.map((r) => ({ id: r.id, fullName: r.fullName, reservedAt: r.reservedAt!.toISOString() })),
    reservationsPerDay: Object.entries(perDay).map(([date, count]) => ({ date, count })),
  });
}
