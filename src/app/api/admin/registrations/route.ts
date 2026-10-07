import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getSettingsMap } from "@/lib/settings";
import { CATEGORY_VALUES, isCategory } from "@/lib/categories";

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

/**
 * Counts for the filter pills and stat cards across ALL registrations, independent of the
 * current page or filter. Everything is read with ONE small query and counted here, because
 * the database pool may allow only a single connection (connection_limit=1).
 */
async function loadStats(withPayments: boolean) {
  const everyone = await prisma.registration.findMany({
    select: { paymentStatus: true, regType: true, amountPaid: true, categories: true },
  });

  const categoryCounts: Record<string, number> = {};
  CATEGORY_VALUES.forEach((c) => (categoryCounts[c] = 0));
  const paymentStats = { notPaid: 0, partial: 0, paid: 0, totalCollected: 0, outstanding: 0, awaitingApproval: 0 };
  let earlyBirdCount = 0;
  let lateCount = 0;
  let outstanding = 0;

  let settings: Record<string, string> | null = null;
  if (withPayments) {
    paymentStats.awaitingApproval = await prisma.registration.count({
      where: { paymentStatus: "NOT_PAID", paymentProofs: { some: { status: "PENDING" } } },
    });
    settings = await getSettingsMap();
  }

  for (const r of everyone) {
    if (r.regType === "LATE") lateCount++;
    else earlyBirdCount++;
    for (const c of r.categories) if (c in categoryCounts) categoryCounts[c]++;
    if (!withPayments || !settings) continue;

    paymentStats.totalCollected += r.amountPaid;
    if (r.paymentStatus === "NOT_PAID") paymentStats.notPaid++;
    else if (r.paymentStatus === "PAID") paymentStats.paid++;
    else {
      paymentStats.partial++;
      // What a partial payer still owes: the fee for their registration type minus what they have paid.
      const fee = parseFloat(r.regType === "LATE" ? settings.late_registration_fee_amount : settings.registration_fee_amount);
      if (Number.isFinite(fee)) outstanding += Math.max(0, fee - r.amountPaid);
    }
  }
  paymentStats.totalCollected = Math.round(paymentStats.totalCollected * 100) / 100;
  paymentStats.outstanding = Math.round(outstanding * 100) / 100;

  return {
    paymentStats,
    regTypeCounts: { all: earlyBirdCount + lateCount, earlyBird: earlyBirdCount, late: lateCount },
    categoryCounts,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search")?.trim() || "";
  const regType = searchParams.get("regType"); // "EARLY_BIRD" | "LATE" | null
  const category = searchParams.get("category"); // one of the register page categories, or null
  // Payments page views: "PAID_PARTIAL" (default there), "PAID", "PARTIAL", "AWAITING" (receipt uploaded, nothing confirmed yet)
  const payView = searchParams.get("payView");
  // lean=1: only the contact details (the Registrations page). Skips email history, seats and receipts, which makes it much faster.
  const lean = searchParams.get("lean") === "1";
  // stats=0: skip the counts for the filter pills and stat cards (used by small lookups).
  const wantStats = searchParams.get("stats") !== "0";
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
      isCategory(category) ? { categories: { has: category } } : {},
      payView === "PAID_PARTIAL"
        ? { paymentStatus: { in: ["PAID", "PARTIAL"] } }
        : payView === "PAID"
          ? { paymentStatus: "PAID" }
          : payView === "PARTIAL"
            ? { paymentStatus: "PARTIAL" }
            : payView === "AWAITING"
              ? { paymentStatus: "NOT_PAID", paymentProofs: { some: { status: "PENDING" } } }
              : {},
    ],
  };
  const paging = { where, orderBy: { createdAt: "desc" as const }, skip: (page - 1) * pageSize, take: pageSize };

  if (lean) {
    const [total, list] = await Promise.all([
      prisma.registration.count({ where }),
      prisma.registration.findMany({
        ...paging,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          country: true,
          categories: true,
          regType: true,
          createdAt: true,
        },
      }),
    ]);
    const stats = wantStats ? await loadStats(false) : null;
    return NextResponse.json({
      registrations: list.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total,
      page,
      pageSize,
      regTypeCounts: stats?.regTypeCounts,
      categoryCounts: stats?.categoryCounts,
    });
  }

  const [total, registrations] = await Promise.all([
    prisma.registration.count({ where }),
    prisma.registration.findMany({
      ...paging,
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

  const stats = wantStats ? await loadStats(true) : null;

  const REMINDER_KINDS = new Set(["payment_reminder", "pay_later_reminder"]);

  const rows = registrations.map((r) => {
    const { status, error } = confirmationStatus(r.emailEvents ?? []);
    // Most recent payment reminder that was actually sent (manual or the automatic pay-later one).
    let lastReminder: Date | null = null;
    for (const e of r.emailEvents ?? []) {
      if (e.type === "SENT" && e.kind && REMINDER_KINDS.has(e.kind) && (!lastReminder || e.occurredAt > lastReminder)) {
        lastReminder = e.occurredAt;
      }
    }
    return {
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      country: r.country,
      organization: r.organization,
      notes: r.notes,
      categories: r.categories,
      regType: r.regType,
      deliveryStatus: status,
      deliveryError: status === "FAILED" ? error : null,
      seatLabel: r.seat?.label ?? null,
      attendanceMode: r.attendanceMode,
      paymentStatus: r.paymentStatus,
      paymentNote: r.paymentNote,
      amountPaid: r.amountPaid,
      paymentUpdatedAt: r.paymentUpdatedAt ? r.paymentUpdatedAt.toISOString() : null,
      seatInviteSentAt: r.seatInviteSentAt ? r.seatInviteSentAt.toISOString() : null,
      lastReminderAt: lastReminder ? lastReminder.toISOString() : null,
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
    paymentStats: stats?.paymentStats,
    regTypeCounts: stats?.regTypeCounts,
    categoryCounts: stats?.categoryCounts,
  });
}