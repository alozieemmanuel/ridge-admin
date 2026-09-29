import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { readSheet } from "@/lib/google-sheets";
import { PROSPECT_FIELDS, resolveColumns, type ManualColumnMap } from "@/lib/prospect-columns";

export const runtime = "nodejs";

/** Shows how the sheet's headers are currently matched to prospect fields, for the "Match columns" dialog. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const source = await prisma.prospectSource.findUnique({ where: { id } });
  if (!source) return NextResponse.json({ error: "Sheet not found." }, { status: 404 });

  try {
    const values = await readSheet(source.spreadsheetId, source.sheetTab);
    const headers = (values[0] ?? []).map((h) => h.trim());
    const manual = (source.columnMap as ManualColumnMap | null) ?? null;
    const { mapping, how } = resolveColumns(headers, manual);

    return NextResponse.json({
      headers: headers.filter(Boolean),
      fields: PROSPECT_FIELDS.map((f) => ({
        key: f.key,
        label: f.label,
        matchedHeader: mapping[f.key] !== undefined ? headers[mapping[f.key] as number] : null,
        how: how[f.key] ?? null,
        manual: manual?.[f.key] ?? "",
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read the sheet." }, { status: 502 });
  }
}
