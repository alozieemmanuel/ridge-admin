import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { EmailEventType } from "@prisma/client";

export const runtime = "nodejs";

const DELIVERY_RANK: Record<EmailEventType, number> = {
  OPENED: 5,
  DELIVERED: 4,
  SENT: 3,
  BOUNCED: 2,
  COMPLAINED: 2,
  FAILED: 1,
};

function latestStatus(events: { type: EmailEventType }[]): string {
  if (events.length === 0) return "NOT_SENT";
  return events.reduce((best, ev) => (DELIVERY_RANK[ev.type] > DELIVERY_RANK[best.type] ? ev : best))
    .type;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search")?.trim() || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10) || 50));

  const where = search
    ? {
        OR: [
          { fullName: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [total, requests] = await Promise.all([
    prisma.brochureRequest.count({ where }),
    prisma.brochureRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        emailEvents: { where: { audience: "ATTENDEE" }, select: { type: true } },
      },
    }),
  ]);

  const rows = requests.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    email: r.email,
    deliveryStatus: latestStatus(r.emailEvents ?? []),
    createdAt: r.createdAt.toISOString(),
  }));

  return NextResponse.json({ requests: rows, total, page, pageSize });
}
