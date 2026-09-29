import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { createProspectSourceSchema } from "@/lib/validation";
import { parseSpreadsheetId } from "@/lib/google-sheets";
import { syncSource } from "@/lib/prospects";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Connects a Google Sheet (owners only) and runs a first sync so problems show up immediately. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an owner can connect a sheet." }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = createProspectSourceSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payload." }, { status: 400 });
  }

  const source = await prisma.prospectSource.create({
    data: {
      name: parsed.data.name,
      spreadsheetId: parseSpreadsheetId(parsed.data.spreadsheet),
      sheetTab: parsed.data.sheetTab,
    },
  });

  await logAdminAction(
    session,
    { action: "prospect.source_create", entityType: "prospect_source", entityId: source.id, entityLabel: source.name },
    request
  );

  const sync = await syncSource(source.id, { force: true });
  return NextResponse.json({ result: "success", sourceId: source.id, sync });
}
