import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";

export const runtime = "nodejs";

/**
 * One event's activity log (owner only). Query: admin=<adminId>, category=<action prefix
 * such as "registration"|"auth"|"campaign">, search=<text>, page, pageSize.
 * Read-only on purpose. No endpoint edits or deletes entries.
 */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { owner: true });
  if (!ctx.ok) return ctx.response;
  const { event } = ctx;

  const { searchParams } = request.nextUrl;
  const adminId = searchParams.get("admin") || undefined;
  const category = searchParams.get("category")?.replace(/[^a-z_]/g, "") || undefined;
  const search = searchParams.get("search")?.trim() || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10) || 50));

  const where: Prisma.AuditLogWhereInput = {
    AND: [
      { eventId: event.id },
      adminId ? { adminId } : {},
      category ? { action: { startsWith: `${category}.` } } : {},
      search
        ? {
            OR: [
              { adminName: { contains: search, mode: "insensitive" } },
              { entityLabel: { contains: search, mode: "insensitive" } },
              { action: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };

  const [total, logs, admins] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.groupBy({ by: ["adminId", "adminName"], where: { eventId: event.id, adminId: { not: null } } }),
  ]);

  return NextResponse.json({
    total,
    page,
    pageSize,
    logs: logs.map((l) => ({
      id: l.id,
      adminId: l.adminId,
      adminName: l.adminName,
      adminEmail: l.adminEmail,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      entityLabel: l.entityLabel,
      details: l.details,
      ipAddress: l.ipAddress,
      createdAt: l.createdAt.toISOString(),
    })),
    admins: admins.map((a) => ({ id: a.adminId, name: a.adminName })),
  });
}