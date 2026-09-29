import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { updateProspectSourceSchema } from "@/lib/validation";
import { PROSPECT_FIELDS } from "@/lib/prospect-columns";
import { syncSource } from "@/lib/prospects";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Rename a connected sheet, change its tab, pause it, or save its column matching (owners only). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an owner can change a connected sheet." }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = updateProspectSourceSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payload." }, { status: 400 });
  }

  const existing = await prisma.prospectSource.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Sheet not found." }, { status: 404 });

  const d = parsed.data;
  let columnMap: Prisma.InputJsonValue | undefined;
  if (d.columnMap) {
    const allowed = new Set<string>(PROSPECT_FIELDS.map((f) => f.key));
    columnMap = Object.fromEntries(Object.entries(d.columnMap).filter(([k, v]) => allowed.has(k) && v.trim() !== ""));
  }

  await prisma.prospectSource.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.sheetTab !== undefined ? { sheetTab: d.sheetTab } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
      ...(columnMap !== undefined ? { columnMap } : {}),
    },
  });

  await logAdminAction(
    session,
    { action: "prospect.source_update", entityType: "prospect_source", entityId: id, entityLabel: existing.name, details: { fields: Object.keys(d) } },
    request
  );

  // A new tab or new column matching changes what the sheet means, so re-read it now.
  const sync = d.sheetTab !== undefined || d.columnMap !== undefined ? await syncSource(id, { force: true }) : null;
  return NextResponse.json({ result: "success", sync });
}

/** Disconnects a sheet and removes its prospects from the dashboard. The sheet itself and any registrations are untouched. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an owner can disconnect a sheet." }, { status: 403 });
  }

  const existing = await prisma.prospectSource.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Sheet not found." }, { status: 404 });

  await prisma.prospectSource.delete({ where: { id } });
  await logAdminAction(
    session,
    { action: "prospect.source_delete", entityType: "prospect_source", entityId: id, entityLabel: existing.name },
    request
  );
  return NextResponse.json({ result: "success" });
}
