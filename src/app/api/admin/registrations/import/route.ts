import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { buildPeople, isImportField, parseCsvText, suggestMapping, type ImportField } from "@/lib/csvImport";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Loads a guest list from a CSV file the browser has read as text. Nothing is emailed.
 *
 * Body: { csv: string, mapping?: { "<CSV header>": field }, onDuplicate?: "skip" | "update", dryRun?: boolean }
 *   - Without `mapping` (or with dryRun) nothing is saved: the answer holds the headers, a suggested mapping,
 *     a few sample rows and what would happen, so the screen can show a preview first.
 *   - onDuplicate decides what happens to an email that is already on the list: "skip" leaves them alone,
 *     "update" fills in what the CSV knows (it never blanks a field and never touches a reservation).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  let body: { csv?: unknown; mapping?: unknown; onDuplicate?: unknown; dryRun?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body.csv !== "string") return NextResponse.json({ error: "Choose a CSV file first." }, { status: 400 });

  let parsed;
  try {
    parsed = parseCsvText(body.csv);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The file could not be read." }, { status: 400 });
  }

  const suggested = suggestMapping(parsed.headers);
  let mapping: Record<string, ImportField> = suggested;
  if (body.mapping && typeof body.mapping === "object") {
    mapping = { ...suggested };
    for (const [header, field] of Object.entries(body.mapping as Record<string, unknown>)) {
      if (parsed.headers.includes(header) && isImportField(field)) mapping[header] = field;
    }
  }

  const { people, problems } = buildPeople(parsed, mapping);
  const mappedFields = new Set(Object.values(mapping));
  const hasName = mappedFields.has("fullName") || mappedFields.has("firstName");
  if (!mappedFields.has("email") || !hasName) {
    return NextResponse.json(
      {
        error: `Tell me which column is the ${!mappedFields.has("email") ? "email address" : "name"}.`,
        headers: parsed.headers,
        mapping,
        sample: parsed.rows.slice(0, 5),
        totalRows: parsed.rows.length,
      },
      { status: 422 }
    );
  }

  const existing = await prisma.registration.findMany({
    where: { email: { in: people.map((p) => p.email) } },
    select: { id: true, email: true },
  });
  const existingByEmail = new Map(existing.map((e) => [e.email, e.id]));
  const newPeople = people.filter((p) => !existingByEmail.has(p.email));
  const dupPeople = people.filter((p) => existingByEmail.has(p.email));

  const onDuplicate = body.onDuplicate === "update" ? "update" : "skip";
  const preview = {
    headers: parsed.headers,
    mapping,
    sample: parsed.rows.slice(0, 5),
    totalRows: parsed.rows.length,
    willAdd: newPeople.length,
    alreadyOnList: dupPeople.length,
    problems: problems.slice(0, 50),
    problemCount: problems.length,
  };
  if (body.dryRun === true || !body.mapping) return NextResponse.json({ result: "preview", ...preview });

  // ---- Save ----
  let added = 0;
  let updated = 0;
  const CHUNK = 500;
  for (let i = 0; i < newPeople.length; i += CHUNK) {
    const res = await prisma.registration.createMany({
      skipDuplicates: true,
      data: newPeople.slice(i, i + CHUNK).map((p) => ({
        fullName: p.fullName,
        email: p.email,
        phone: p.phone,
        organization: p.organization,
        followUpStatus: p.followUpStatus ?? "NOT_CONTACTED",
        callFeedback: p.callFeedback,
        extra: Object.keys(p.extra).length ? p.extra : undefined,
      })),
    });
    added += res.count;
  }

  if (onDuplicate === "update") {
    for (const p of dupPeople) {
      const id = existingByEmail.get(p.email)!;
      await prisma.registration.update({
        where: { id },
        data: {
          fullName: p.fullName,
          ...(p.phone ? { phone: p.phone } : {}),
          ...(p.organization ? { organization: p.organization } : {}),
          ...(p.followUpStatus ? { followUpStatus: p.followUpStatus } : {}),
          ...(p.callFeedback ? { callFeedback: p.callFeedback } : {}),
          ...(Object.keys(p.extra).length ? { extra: p.extra } : {}),
        },
      });
      updated++;
    }
  }

  await logAdminAction(
    session,
    {
      action: "participants.import",
      entityType: "data",
      details: { rows: parsed.rows.length, added, updated, skipped: onDuplicate === "skip" ? dupPeople.length : 0, problems: problems.length },
    },
    request
  );

  return NextResponse.json({
    result: "imported",
    added,
    updated,
    skipped: onDuplicate === "skip" ? dupPeople.length : 0,
    problemCount: problems.length,
    problems: problems.slice(0, 50),
  });
}
