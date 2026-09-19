/**
 * Backfills BrochureRequest rows from a CSV export (e.g. Google Sheets:
 * File > Download > Comma Separated Values).
 *
 * Usage:
 *   npm run import:brochure -- path/to/export.csv --dry-run   (preview only)
 *   npm run import:brochure -- path/to/export.csv             (import)
 *
 * Recognised headers (case-insensitive, first match wins):
 *   name:      Full Name, Name, Fullname
 *   email:     Email, Email Address, E-mail
 *   timestamp: Timestamp, Date, Created, Created At, Submitted
 *
 * Skips rows with no valid email. Skips emails already in the database, so it
 * is safe to re-run. It never sends any email.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const prisma = new PrismaClient();

const NAME_HEADERS = ["full name", "fullname", "name"];
const EMAIL_HEADERS = ["email address", "e-mail", "email"];
const TIME_HEADERS = ["timestamp", "created at", "created", "submitted", "date"];

/** Minimal CSV parser that handles quoted fields, commas and newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function findColumn(headers: string[], candidates: string[]): number {
  const lowered = headers.map((h) => h.trim().toLowerCase());
  for (const candidate of candidates) {
    const idx = lowered.indexOf(candidate);
    if (idx !== -1) return idx;
  }
  return -1;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value || !value.trim()) return undefined;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filePath = args.find((a) => !a.startsWith("--"));

  if (!filePath) {
    console.error("Usage: npm run import:brochure -- path/to/export.csv [--dry-run]");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  if (rows.length < 2) {
    console.error("The CSV has no data rows.");
    process.exit(1);
  }

  const headers = rows[0];
  const nameCol = findColumn(headers, NAME_HEADERS);
  const emailCol = findColumn(headers, EMAIL_HEADERS);
  const timeCol = findColumn(headers, TIME_HEADERS);

  console.log("Headers found:", headers.map((h) => h.trim()).join(" | "));
  console.log(
    `Matched columns -> name: ${nameCol === -1 ? "NONE" : headers[nameCol]}, ` +
      `email: ${emailCol === -1 ? "NONE" : headers[emailCol]}, ` +
      `timestamp: ${timeCol === -1 ? "none (will use now)" : headers[timeCol]}`
  );

  if (emailCol === -1) {
    console.error("\nCould not find an email column. Rename it to 'Email' in the CSV and run again.");
    process.exit(1);
  }

  const existing = new Set(
    (await prisma.brochureRequest.findMany({ select: { email: true } })).map((r) => r.email.toLowerCase())
  );

  let toCreate = 0;
  let skippedInvalid = 0;
  let skippedExisting = 0;
  let skippedDuplicateInFile = 0;
  const seenInFile = new Set<string>();
  const pending: { fullName: string; email: string; createdAt?: Date }[] = [];

  for (const row of rows.slice(1)) {
    const email = (row[emailCol] ?? "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      skippedInvalid++;
      continue;
    }
    if (seenInFile.has(email)) {
      skippedDuplicateInFile++;
      continue;
    }
    seenInFile.add(email);
    if (existing.has(email)) {
      skippedExisting++;
      continue;
    }

    const fullName = nameCol === -1 ? "" : (row[nameCol] ?? "").trim();
    pending.push({
      fullName: fullName || email.split("@")[0],
      email,
      createdAt: timeCol === -1 ? undefined : parseDate(row[timeCol]),
    });
    toCreate++;
  }

  console.log(`\nRows in file:            ${rows.length - 1}`);
  console.log(`Will import:             ${toCreate}`);
  console.log(`Skipped (bad email):     ${skippedInvalid}`);
  console.log(`Skipped (already in DB): ${skippedExisting}`);
  console.log(`Skipped (dupe in file):  ${skippedDuplicateInFile}`);

  if (dryRun) {
    console.log("\nDry run. Nothing was written.");
    if (pending.length > 0) console.log("First rows:", pending.slice(0, 3));
    return;
  }

  if (pending.length > 0) {
    await prisma.brochureRequest.createMany({ data: pending });
  }
  console.log(`\nDone. Imported ${pending.length} brochure requests. No emails were sent.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());