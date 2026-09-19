import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma, EmailEventType } from "@prisma/client";

export const runtime = "nodejs";

const DELIVERY_RANK: Record<EmailEventType, number> = {
  OPENED: 5,
  DELIVERED: 4,
  SENT: 3,
  BOUNCED: 2,
  COMPLAINED: 2,
  FAILED: 1,
};

function latestStatus(events: { type: EmailEventType; occurredAt: Date }[]): string {
  if (events.length === 0) return "NOT_SENT";
  // "Best" status wins ties on the same email (e.g. SENT then DELIVERED then
  // OPENED are all real, increasingly-informative signals about one send).
  return events.reduce((best, ev) => (DELIVERY_RANK[ev.type] > DELIVERY_RANK[best.type] ? ev : best))
    .type;
}

/** The most recent failure reason among a row's attendee emails (shown on hover in the dashboard). */
function latestError(events: { type: EmailEventType; occurredAt: Date; errorMessage: string | null }[]): string | null {
  const failed = events
    .filter((e) => e.type === "FAILED" && e.errorMessage)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  return failed[0]?.errorMessage ?? null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search")?.trim() || "";
  const regType = searchParams.get("regType"); // "EARLY_BIRD" | "LATE" | null
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
            ],
          }
        : {},
      regType === "EARLY_BIRD" || regType === "LATE" ? { regType } : {},
    ],
  };

  const [total, registrations, allAttendeeEvents] = await Promise.all([
    prisma.registration.count({ where }),
    prisma.registration.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        emailEvents: {
          where: { audience: "ATTENDEE" },
          select: { type: true, occurredAt: true, errorMessage: true },
        },
        seat: { select: { label: true } },
      },
    }),
    // Aggregate stats are computed across ALL registrations (not just this
    // page), matching the "Emails: Delivered / Opened / Bounced / Dropped"
    // summary line shown above the table.
    prisma.emailEvent.findMany({
      where: { source: "REGISTRATION", audience: "ATTENDEE" },
      select: { registrationId: true, type: true, occurredAt: true },
    }),
  ]);

  const byRegistration = new Map<string, { type: EmailEventType; occurredAt: Date }[]>();
  for (const ev of allAttendeeEvents) {
    if (!ev.registrationId) continue;
    const list = byRegistration.get(ev.registrationId) ?? [];
    list.push(ev);
    byRegistration.set(ev.registrationId, list);
  }
  const totalRegistrations = await prisma.registration.count();
  let notSentCount = totalRegistrations;
  const statusCounts: Record<string, number> = {
    DELIVERED: 0,
    OPENED: 0,
    BOUNCED: 0,
    FAILED: 0,
    SENT: 0,
  };
  for (const [, events] of byRegistration) {
    notSentCount -= 1;
    const status = latestStatus(events);
    if (status in statusCounts) statusCounts[status] += 1;
  }

  // Payment stats are also computed across ALL registrations, independent
  // of the current page/filter, for the summary line above the table.
  const [paymentGroups, paymentTotal] = await Promise.all([
    prisma.registration.groupBy({
      by: ["paymentStatus"],
      _count: { paymentStatus: true },
    }),
    prisma.registration.aggregate({ _sum: { amountPaid: true } }),
  ]);
  const paymentStats = { notPaid: 0, partial: 0, paid: 0, totalCollected: paymentTotal._sum.amountPaid ?? 0 };
  for (const g of paymentGroups) {
    if (g.paymentStatus === "NOT_PAID") paymentStats.notPaid = g._count.paymentStatus;
    else if (g.paymentStatus === "PARTIAL") paymentStats.partial = g._count.paymentStatus;
    else if (g.paymentStatus === "PAID") paymentStats.paid = g._count.paymentStatus;
  }

  const rows = registrations.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    email: r.email,
    phone: r.phone,
    country: r.country,
    organization: r.organization,
    notes: r.notes,
    regType: r.regType,
    deliveryStatus: latestStatus(r.emailEvents ?? []),
    deliveryError: latestStatus(r.emailEvents ?? []) === "FAILED" ? latestError(r.emailEvents ?? []) : null,
    seatLabel: r.seat?.label ?? null,
    paymentStatus: r.paymentStatus,
    paymentNote: r.paymentNote,
    amountPaid: r.amountPaid,
    paymentUpdatedAt: r.paymentUpdatedAt ? r.paymentUpdatedAt.toISOString() : null,
    seatInviteSentAt: r.seatInviteSentAt ? r.seatInviteSentAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

  return NextResponse.json({
    registrations: rows,
    total,
    page,
    pageSize,
    emailStats: {
      delivered: statusCounts.DELIVERED,
      opened: statusCounts.OPENED,
      bounced: statusCounts.BOUNCED,
      failed: statusCounts.FAILED,
      sentOnly: statusCounts.SENT,
      notSent: notSentCount,
    },
    paymentStats,
  });
}
