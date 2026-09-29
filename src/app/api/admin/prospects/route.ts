import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isSheetsConfigured, serviceAccountEmail } from "@/lib/google-sheets";

export const runtime = "nodejs";

/** All prospects (newest first) plus the connected sheets, for the Prospects page. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [prospects, sources] = await Promise.all([
    prisma.prospect.findMany({
      orderBy: { createdAt: "desc" },
      take: 3000,
      include: { registration: { select: { id: true, email: true } } },
    }),
    prisma.prospectSource.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

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
    prospects: prospects.map((p) => ({
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
