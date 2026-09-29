import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { updateProspectSchema } from "@/lib/validation";
import { writeBackProspect } from "@/lib/prospects";

export const runtime = "nodejs";

/**
 * Saves the call-tracking fields for one prospect and writes them to the
 * sheet row. The edit is always saved here first; if the sheet update fails
 * (for example the sheet was unshared), the prospect is flagged and the edit
 * is retried on the next sync instead of being lost.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = updateProspectSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payload." }, { status: 400 });
  }

  const existing = await prisma.prospect.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Prospect not found." }, { status: 404 });

  const d = parsed.data;
  const updated = await prisma.prospect.update({
    where: { id },
    data: {
      ...(d.callRequested !== undefined ? { callRequested: d.callRequested || null } : {}),
      ...(d.callSchedule !== undefined ? { callSchedule: d.callSchedule || null } : {}),
      ...(d.callCompleted !== undefined ? { callCompleted: d.callCompleted } : {}),
      ...(d.callFeedback !== undefined ? { callFeedback: d.callFeedback || null } : {}),
      ...(d.followUpRequired !== undefined ? { followUpRequired: d.followUpRequired } : {}),
      ...(d.confirmation !== undefined ? { confirmation: d.confirmation || null } : {}),
      dirty: true,
    },
  });

  await logAdminAction(
    session,
    { action: "prospect.update", entityType: "prospect", entityId: id, entityLabel: existing.fullName, details: { fields: Object.keys(d) } },
    request
  );

  const sheet = existing.sheetRow === null
    ? { ok: false, missingColumns: [] as string[], error: "This person is no longer in the sheet, so only the dashboard was updated." }
    : await writeBackProspect(updated);

  return NextResponse.json({
    result: "success",
    sheetUpdated: sheet.ok,
    sheetError: sheet.error ?? null,
    missingColumns: sheet.missingColumns,
  });
}
