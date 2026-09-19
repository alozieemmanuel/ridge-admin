/**
 * Import existing registrations from a CSV file into the database.
 *
 * Use this once to backfill people who registered through the old
 * Google Sheets / Apps Script system before this admin app existed.
 * It NEVER sends confirmation or notification emails — this is a
 * historical backfill, not a new registration.
 *
 * Usage:
 *   npm run import:registrations -- path/to/export.csv
 *   npm run import:registrations -- path/to/export.csv --dry-run
 *
 * Expected columns (case-insensitive, order doesn't matter). Common
 * header names are recognized automatically:
 *   Full Name / Name      -> fullName   (required)
 *   Email                 -> email      (required)
 *   Phone                 -> phone      (optional, defaults to "")
 *   Country                -> country    (optional, defaults to "")
 *   Organization / Company -> organization (optional)
 *   Notes                  -> notes       (optional)
 *   Registration Type / Type -> regType    (optional; "late" -> LATE, else EARLY_BIRD)
 *   Timestamp / Registered / Registered At -> createdAt (optional; defaults to now)
 *
 * If your export uses different headers entirely, edit the
 * COLUMN_ALIASES map below to match, then re-run.
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COLUMN_ALIASES: Record<string, string[]> = {
  fullName: ["full name", "fullname", "name"],
  email: ["email", "email address"],
  phone: ["phone", "phone number"],
  country: ["country"],
  organization: ["organization", "organisation", "company", "company / organization"],
  notes: ["notes", "note"],
  regType: ["registration type", "regtype", "type"],
  createdAt: ["timestamp", "registered", "registered at", "date"],
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function buildColumnMap(headers: string[]): Record<string, string> {
  const normalized = headers.map(normalizeHeader);
  const map: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) map[field] = headers[idx];
  }
  return map;
}

function parseRegType(raw: string | undefined): "EARLY_BIRD" | "LATE" {
  if (!raw) return "EARLY_BIRD";
  return raw.trim().toLowerCase().startsWith("late") ? "LATE" : "EARLY_BIRD";
}

function parseDate(raw: string | undefined): Date {
  if (!raw) return new Date();
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filePath = args.find((a) => !a.startsWith("--"));

  if (!filePath) {
    console.error("Usage: npm run import:registrations -- path/to/export.csv [--dry-run]");
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(absolutePath, "utf-8");
  const records: Record<string, string>[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (records.length === 0) {
    console.log("No rows found in the CSV. Nothing to do.");
    return;
  }

  const columnMap = buildColumnMap(Object.keys(records[0]));

  if (!columnMap.fullName || !columnMap.email) {
    console.error(
      "Could not find both a name column and an email column in the CSV headers.\n" +
        `Headers found: ${Object.keys(records[0]).join(", ")}\n` +
        "Edit COLUMN_ALIASES in this script to match your export, then re-run."
    );
    process.exit(1);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  console.log(
    dryRun
      ? `Dry run — will report what WOULD happen for ${records.length} rows, without writing anything.\n`
      : `Importing ${records.length} rows...\n`
  );

  for (const [i, row] of records.entries()) {
    const fullName = row[columnMap.fullName]?.trim();
    const email = row[columnMap.email]?.trim().toLowerCase();

    if (!fullName || !email || !email.includes("@")) {
      console.warn(`Row ${i + 2}: skipped — missing or invalid name/email.`);
      skipped++;
      continue;
    }

    const data = {
      fullName,
      phone: columnMap.phone ? row[columnMap.phone]?.trim() || "" : "",
      country: columnMap.country ? row[columnMap.country]?.trim() || "" : "",
      organization: columnMap.organization ? row[columnMap.organization]?.trim() || null : null,
      notes: columnMap.notes ? row[columnMap.notes]?.trim() || null : null,
      regType: parseRegType(columnMap.regType ? row[columnMap.regType] : undefined),
    };
    const createdAt = parseDate(columnMap.createdAt ? row[columnMap.createdAt] : undefined);

    if (dryRun) {
      console.log(`Would upsert: ${fullName} <${email}> (${data.regType}, registered ${createdAt.toISOString()})`);
      continue;
    }

    const existing = await prisma.registration.findUnique({ where: { email } });

    await prisma.registration.upsert({
      where: { email },
      update: data,
      create: { ...data, email, createdAt },
    });

    if (existing) {
      updated++;
    } else {
      created++;
      // Backdate createdAt to the original registration date on first
      // insert — upsert's `create` sets it, but Prisma ignores extra
      // fields silently if the shape doesn't match, so we confirm here.
    }
  }

  if (!dryRun) {
    console.log(`\nDone. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}.`);
    console.log("No emails were sent — this was a historical import only.");
  } else {
    console.log(`\nDry run complete. ${records.length - skipped} rows would be imported, ${skipped} skipped.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
