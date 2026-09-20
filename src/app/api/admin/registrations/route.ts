import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

type ConfirmationStatus = "SENT" | "FAILED" | "NOT_SENT";

interface AttendeeEvent {
  type: string;
  occurredAt: Date;
  errorMessage: string | null;
  kind: string | null;
}

/**
 * Only the registration CONFIRMATION email counts for the status column.
 * Seat invites and payment reminders are separate emails, so a successful
 * reminder must not hide a failed confirmation. Events recorded before `kind`
 * existed have kind = null and are treated as confirmations.
 *
 * The most recent attempt decides. A failed first attempt followed by a
 * successful resend therefore shows Sent.
 */
function confirmationStatus(events: AttendeeEvent[]): { status: ConfirmationStatus; error: string | null } {
  const confirmations = events.filter((e) => e.kind === null || e.kind === "confirmation");
  if (confirmations.length === 0) return { status: "NOT_SENT", error: null };

  const failedTypes = new Set(["FAILED", "BOUNCED", "COMPLAINED"]);
  const ordered = [...confirmations].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  const latestAttempt = ordered.find((e) => e.type === "SENT" || e.type === "FAILED");
  const bounced = ordered.some((e) => e.type === "BOUNCED" || e.type === "COMPLAINED");

  if (latestAttempt?.type === "FAILED" || (bounced && !latestAttempt)) {
    const reason = ordered.find((e) => failedTypes.has(e.type) && e.errorMessage)?.errorMessage ?? null;
    return { status: "FAILED", error: reason };
  }
  if (bounced) {
    return { status: "FAILED", error: "The recipient's mail server rejected this email." };
  }
  return { status: "SENT", error: null };
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

  // Run the queries one group at a time so a small connection pool is never
  // asked for more connections than it has.
  const [total, registrations] = await Promise.all([
    prisma.registration.count({ where }),
    prisma.registration.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        emailEvents: {
          where: { audience: "ATTENDEE", source: "REGISTRATION" },
          select: { type: true, occurredAt: true, errorMessage: true, kind: true },
        },
        seat: { select: { label: true } },
        paymentProofs: {
          select: {
            id: true,
            fileName: true,
            currency: true,
            method: true,
            amountClaimed: true,
            expectedAmount: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  ]);

  // Payment stats and registration-type counts across ALL registrations,
  // independent of the current page/filter.
  const [paymentGroups, paymentTotal, regTypeGroups] = await Promise.all([
    prisma.registration.groupBy({
      by: ["paymentStatus"],
      _count: { paymentStatus: true },
    }),
    prisma.registration.aggregate({ _sum: { amountPaid: true } }),
    prisma.registration.groupBy({
      by: ["regType"],
      _count: { regType: true },
    }),
  ]);

  const paymentStats = { notPaid: 0, partial: 0, paid: 0, totalCollected: paymentTotal._sum.amountPaid ?? 0 };
  for (const g of paymentGroups) {
    if (g.paymentStatus === "NOT_PAID") paymentStats.notPaid = g._count.paymentStatus;
    else if (g.paymentStatus === "PARTIAL") paymentStats.partial = g._count.paymentStatus;
    else if (g.paymentStatus === "PAID") paymentStats.paid = g._count.paymentStatus;
  }

  let earlyBirdCount = 0;
  let lateCount = 0;
  for (const g of regTypeGroups) {
    if (g.regType === "EARLY_BIRD") earlyBirdCount = g._count.regType;
    else if (g.regType === "LATE") lateCount = g._count.regType;
  }
  const regTypeCounts = { all: earlyBirdCount + lateCount, earlyBird: earlyBirdCount, late: lateCount };

  const rows = registrations.map((r) => {
    const { status, error } = confirmationStatus(r.emailEvents ?? []);
    return {
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      country: r.country,
      organization: r.organization,
      notes: r.notes,
      regType: r.regType,
      deliveryStatus: status,
      deliveryError: status === "FAILED" ? error : null,
      seatLabel: r.seat?.label ?? null,
      paymentStatus: r.paymentStatus,
      paymentNote: r.paymentNote,
      amountPaid: r.amountPaid,
      paymentUpdatedAt: r.paymentUpdatedAt ? r.paymentUpdatedAt.toISOString() : null,
      seatInviteSentAt: r.seatInviteSentAt ? r.seatInviteSentAt.toISOString() : null,
      proofs: r.paymentProofs.map((p) => ({
        id: p.id,
        fileName: p.fileName,
        currency: p.currency,
        method: p.method,
        amountClaimed: p.amountClaimed,
        expectedAmount: p.expectedAmount,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
      createdAt: r.createdAt.toISOString(),
    };
  });

  return NextResponse.json({
    registrations: rows,
    total,
    page,
    pageSize,
    paymentStats,
    regTypeCounts,
  });
}