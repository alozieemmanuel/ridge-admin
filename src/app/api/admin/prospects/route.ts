import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isSheetsConfigured, serviceAccountEmail } from "@/lib/google-sheets";
import { interpretStatus } from "@/lib/prospect-columns";
import {
  PROSPECT_FILTERS,
  computeStats,
  matchesFilter,
  matchesSearch,
  type ProspectFilter,
  type ProspectLite,
} from "@/lib/prospect-filters";

export const runtime = "nodejs";

/**
 * One page of prospects (newest first) plus the connected sheets and the counters, for the Prospects page.
 *
 * Query: page, pageSize (max 200), search, filter, sourceId, today ("YYYY-MM-DD" on the admin's clock).
 *
 * The filters work from call schedules typed in a sheet, so they run here in code. To keep that cheap,
 * everyone is read with a short list of fields, the filters and counters are worked out from that, and
 * the full details (feedback, extra columns) are loaded only for the rows on the requested page.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search")?.trim() || "";
  const filterParam = searchParams.get("filter") as ProspectFilter | null;
  const filter: ProspectFilter = filterParam && PROSPECT_FILTERS.includes(filterParam) ? filterParam : "ALL";
  const sourceId = searchParams.get("sourceId") || "";
  const todayParam = searchParams.get("today") || "";
  const today = /^\d{4}-\d{2}-\d{2}$/.test(todayParam) ? todayParam : new Date().toISOString().slice(0, 10);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10) || 50));

  const sources = await prisma.prospectSource.findMany({ orderBy: { createdAt: "asc" } });
  const all = await prisma.prospect.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      sourceId: true,
      fullName: true,
      email: true,
      phone: true,
      callRequested: true,
      callSchedule: true,
      callCompleted: true,
      followUpRequired: true,
      registrationId: true,
    },
  });

  const pool: (ProspectLite & { id: string })[] = sourceId ? all.filter((p) => p.sourceId === sourceId) : all;
  const stats = computeStats(pool, today);
  const matching = pool.filter((p) => matchesFilter(p, filter, today) && matchesSearch(p, search));
  const total = matching.length;
  const pageIds = matching.slice((page - 1) * pageSize, page * pageSize).map((p) => p.id);

  const details = pageIds.length
    ? await prisma.prospect.findMany({ where: { id: { in: pageIds } } })
    : [];
  const byId = new Map(details.map((p) => [p.id, p]));
  const pageRows = pageIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p));

  // Used by the edit dialog: whether the sheet uses a STATUS dropdown, and which values exist.
  const statusMode = all.some((p) => interpretStatus(p.callRequested) !== null);
  const callOptions = Array.from(new Set(all.map((p) => p.callRequested).filter((v): v is string => Boolean(v))));

  return NextResponse.json({
    configured: isSheetsConfigured(),
    serviceAccountEmail: serviceAccountEmail(),
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      sheetTab: s.sheetTab,
      spreadsheetId: s.spreadsheetId,
      active: s.active,
      hasManualMapping: Boolean(s.columnMap && Object.keys(s.columnMap as object).length > 0),
      lastSyncedAt: s.lastSyncedAt ? s.lastSyncedAt.toISOString() : null,
      lastSyncError: s.lastSyncError,
    })),
    total,
    page,
    pageSize,
    stats,
    statusMode,
    callOptions,
    totalAll: all.length,
    prospects: pageRows.map((p) => ({
      id: p.id,
      sourceId: p.sourceId,
      fullName: p.fullName,
      email: p.email,
      phone: p.phone,
      callRequested: p.callRequested,
      callSchedule: p.callSchedule,
      callCompleted: p.callCompleted,
      callFeedback: p.callFeedback,
      followUpRequired: p.followUpRequired,
      confirmation: p.confirmation,
      extra: (p.extra as Record<string, string> | null) ?? null,
      inSheet: p.sheetRow !== null,
      dirty: p.dirty,
      writeBackError: p.writeBackError,
      registrationId: p.registrationId,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}
