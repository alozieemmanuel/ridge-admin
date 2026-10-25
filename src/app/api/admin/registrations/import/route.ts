import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import { buildPeople, isImportField, parseCsvText, suggestMapping, type ImportField } from "@/lib/csvImport";
import { saveImportedPeople } from "@/lib/contactSave";

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
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;
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
    where: { eventId: event.id, email: { in: people.map((p) => p.email) } },
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
  const saved = await saveImportedPeople(event.id, people, onDuplicate, { author: "Imported from CSV", overwriteStatus: true });
  const { added, updated } = saved;

  await logAdminAction(
    session,
    {
      action: "participants.import",
      entityType: "data",
      details: { rows: parsed.rows.length, added, updated, skipped: saved.skipped, problems: problems.length },
    },
    request
  );

  return NextResponse.json({
    result: "imported",
    added,
    updated,
    skipped: saved.skipped,
    problemCount: problems.length,
    problems: problems.slice(0, 50),
  });
}
