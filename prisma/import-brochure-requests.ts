/**
 * Import existing brochure requests from a CSV file into the database.
 *
 * Usage:
 *   npm run import:brochure-requests -- path/to/export.csv
 *   npm run import:brochure-requests -- path/to/export.csv --dry-run
 *
 * Expected columns (case-insensitive): Full Name / Name, Email,
 * Timestamp / Requested / Date (optional). Never sends emails — this is a
 * historical backfill.
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COLUMN_ALIASES: Record<string, string[]> = {
  fullName: ["full name", "fullname", "name"],
  email: ["email", "email address"],
  createdAt: ["timestamp", "requested", "requested at", "date"],
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
    console.error("Usage: npm run import:brochure-requests -- path/to/export.csv [--dry-run]");
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
  let skipped = 0;
  let duplicates = 0;

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

    const createdAt = parseDate(columnMap.createdAt ? row[columnMap.createdAt] : undefined);

    if (dryRun) {
      console.log(`Would create: ${fullName} <${email}> (requested ${createdAt.toISOString()})`);
      continue;
    }

    // Brochure requests aren't unique-by-email in the schema (someone can
    // legitimately request twice), but for a one-time historical import we
    // don't want to duplicate the same row if this script is re-run.
    const existing = await prisma.brochureRequest.findFirst({ where: { email, fullName } });
    if (existing) {
      duplicates++;
      continue;
    }

    await prisma.brochureRequest.create({
      data: { fullName, email, createdAt },
    });
    created++;
  }

  if (!dryRun) {
    console.log(`\nDone. Created: ${created}, Skipped: ${skipped}, Already existed: ${duplicates}.`);
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