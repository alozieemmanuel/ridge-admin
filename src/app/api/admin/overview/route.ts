import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { FOLLOW_UP_VALUES } from "@/lib/followUp";
import { getCapacity } from "@/lib/reservations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

/** Everything the Overview page shows, counted in one go. */
export async function GET() {
  const [capacity, total, invited, reserved, checkedIn, groups, withPhone, withFeedback, withNotes, recent, reservedDates] = await Promise.all([
    getCapacity(),
    prisma.registration.count(),
    prisma.registration.count({ where: { OR: [{ inviteSentAt: { not: null } }, { reservedAt: { not: null } }] } }),
    prisma.registration.count({ where: { reservedAt: { not: null } } }),
    prisma.registration.count({ where: { checkedInAt: { not: null } } }),
    prisma.registration.groupBy({ by: ["followUpStatus"], _count: { _all: true } }),
    prisma.registration.count({ where: { phone: { not: "" } } }),
    prisma.registration.count({ where: { callFeedback: { not: null } } }),
    prisma.registration.count({ where: { followUpNotes: { some: {} } } }),
    prisma.registration.findMany({
      where: { reservedAt: { not: null } },
      orderBy: { reservedAt: "desc" },
      take: 6,
      select: { id: true, fullName: true, reservedAt: true },
    }),
    prisma.registration.findMany({ where: { reservedAt: { gte: new Date(Date.now() - 14 * DAY) } }, select: { reservedAt: true } }),
  ]);

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
    withPhone,
    withFeedback,
    withNotes,
    recentReservations: recent.map((r) => ({ id: r.id, fullName: r.fullName, reservedAt: r.reservedAt!.toISOString() })),
    reservationsPerDay: Object.entries(perDay).map(([date, count]) => ({ date, count })),
  });
}
