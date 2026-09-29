import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Prospect, ProspectSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readSheet, updateCells, type CellUpdate } from "@/lib/google-sheets";
import {
  RIDGE_ID_HEADER,
  formatBoolForSheet,
  parseBool,
  resolveColumns,
  type ManualColumnMap,
  type ProspectFieldKey,
} from "@/lib/prospect-columns";

/** How long a sync result is reused before another sync is allowed (protects the Sheets quota). */
const MIN_SYNC_INTERVAL_MS = 20_000;

const inFlight = new Map<string, Promise<SyncResult>>();

export interface SyncResult {
  sourceId: string;
  ok: boolean;
  skipped?: boolean;
  created: number;
  updated: number;
  removed: number;
  error?: string;
}

function newExternalId(): string {
  return `rp_${crypto.randomBytes(5).toString("hex")}`;
}

function cell(row: string[], idx: number | undefined): string {
  return idx === undefined ? "" : (row[idx] ?? "").trim();
}

function asManualMap(value: Prisma.JsonValue | null): ManualColumnMap | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ManualColumnMap) : null;
}

/**
 * Pulls one sheet into the database.
 *  - Each row is identified by a "RIDGE ID" column. If the sheet has none, the
 *    column is added to the right of the data, and every row gets an ID, so
 *    rows can be re-sorted or deleted in the sheet without mixing people up.
 *  - The sheet wins for name/contact details. For the fields admins edit here,
 *    the sheet wins too, unless an edit made here hasn't reached the sheet yet
 *    (dirty), in which case it is retried instead of overwritten.
 */
export async function syncSource(sourceId: string, opts: { force?: boolean } = {}): Promise<SyncResult> {
  const existing = inFlight.get(sourceId);
  if (existing) return existing;

  const run = doSync(sourceId, opts).finally(() => inFlight.delete(sourceId));
  inFlight.set(sourceId, run);
  return run;
}

async function doSync(sourceId: string, opts: { force?: boolean }): Promise<SyncResult> {
  const result: SyncResult = { sourceId, ok: false, created: 0, updated: 0, removed: 0 };

  const source = await prisma.prospectSource.findUnique({ where: { id: sourceId } });
  if (!source) return { ...result, error: "Sheet connection not found." };

  if (!opts.force && source.lastSyncedAt && !source.lastSyncError && Date.now() - source.lastSyncedAt.getTime() < MIN_SYNC_INTERVAL_MS) {
    return { ...result, ok: true, skipped: true };
  }

  try {
    const values = await readSheet(source.spreadsheetId, source.sheetTab);
    if (values.length === 0) {
      throw new Error(`The tab "${source.sheetTab}" is empty or doesn't exist. Add a header row first.`);
    }

    const headers = values[0].map((h) => h.trim());
    const { mapping } = resolveColumns(headers, asManualMap(source.columnMap));
    if (mapping.fullName === undefined) {
      throw new Error('No "Full Name" column found. Open "Match columns" and pick which column holds the name.');
    }

    // The ID column: use the existing one, or add a new one after the last header.
    const cellUpdates: CellUpdate[] = [];
    let idCol = mapping.externalId;
    if (idCol === undefined) {
      idCol = headers.length;
      cellUpdates.push({ row: 1, col: idCol, value: RIDGE_ID_HEADER });
    }

    const known = await prisma.prospect.findMany({ where: { sourceId } });
    const knownByExternal = new Map(known.map((p) => [p.externalId, p]));

    const mappedColumns = new Set(Object.values(mapping) as number[]);
    mappedColumns.add(idCol);

    const seen = new Set<string>();
    const toCreate: Prisma.ProspectCreateManyInput[] = [];
    const toUpdate: { id: string; data: Prisma.ProspectUpdateInput }[] = [];

    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const fullName = cell(row, mapping.fullName);
      if (!fullName) continue; // blank or spacer row

      let externalId = cell(row, idCol);
      if (!externalId || seen.has(externalId)) {
        // New row, or a copied row that duplicated another row's ID.
        externalId = newExternalId();
        cellUpdates.push({ row: r + 1, col: idCol, value: externalId });
      }
      seen.add(externalId);

      const extra: Record<string, string> = {};
      headers.forEach((h, i) => {
        const v = (row[i] ?? "").trim();
        if (h && v && !mappedColumns.has(i)) extra[h] = v;
      });

      const fields = {
        fullName,
        email: cell(row, mapping.email).toLowerCase() || null,
        phone: cell(row, mapping.phone) || null,
        callRequested: cell(row, mapping.callRequested) || null,
        callSchedule: cell(row, mapping.callSchedule) || null,
        callCompleted: parseBool(cell(row, mapping.callCompleted)),
        callFeedback: cell(row, mapping.callFeedback) || null,
        followUpRequired: parseBool(cell(row, mapping.followUpRequired)),
        confirmation: cell(row, mapping.confirmation) || null,
      };
      const extraJson = Object.keys(extra).length > 0 ? extra : null;

      const current = knownByExternal.get(externalId);
      if (!current) {
        toCreate.push({
          sourceId,
          externalId,
          sheetRow: r + 1,
          ...fields,
          extra: extraJson ?? undefined,
        });
        continue;
      }

      const data: Prisma.ProspectUpdateInput = {};
      if (current.sheetRow !== r + 1) data.sheetRow = r + 1;
      if (current.fullName !== fields.fullName) data.fullName = fields.fullName;
      if (current.email !== fields.email) data.email = fields.email;
      if (current.phone !== fields.phone) data.phone = fields.phone;
      if (JSON.stringify(current.extra ?? null) !== JSON.stringify(extraJson)) {
        data.extra = extraJson ?? Prisma.JsonNull;
      }
      if (!current.dirty) {
        if (current.callRequested !== fields.callRequested) data.callRequested = fields.callRequested;
        if (current.callSchedule !== fields.callSchedule) data.callSchedule = fields.callSchedule;
        if (current.callCompleted !== fields.callCompleted) data.callCompleted = fields.callCompleted;
        if (current.callFeedback !== fields.callFeedback) data.callFeedback = fields.callFeedback;
        if (current.followUpRequired !== fields.followUpRequired) data.followUpRequired = fields.followUpRequired;
        if (current.confirmation !== fields.confirmation) data.confirmation = fields.confirmation;
      }
      if (Object.keys(data).length > 0) toUpdate.push({ id: current.id, data });
    }

    // Write the new IDs (and header) first, so a failure here doesn't leave rows we can't find again.
    await updateCells(source.spreadsheetId, source.sheetTab, cellUpdates);

    if (toCreate.length > 0) {
      await prisma.prospect.createMany({ data: toCreate, skipDuplicates: true });
      result.created = toCreate.length;
    }
    for (let i = 0; i < toUpdate.length; i += 25) {
      const chunk = toUpdate.slice(i, i + 25);
      await prisma.$transaction(chunk.map((u) => prisma.prospect.update({ where: { id: u.id }, data: u.data })));
    }
    result.updated = toUpdate.length;

    // Rows that are no longer in the sheet stay here (they may be converted already) but lose their row number.
    const gone = known.filter((p) => !seen.has(p.externalId) && p.sheetRow !== null);
    if (gone.length > 0) {
      await prisma.prospect.updateMany({ where: { id: { in: gone.map((p) => p.id) } }, data: { sheetRow: null } });
      result.removed = gone.length;
    }

    await prisma.prospectSource.update({
      where: { id: sourceId },
      data: { lastSyncedAt: new Date(), lastSyncError: null },
    });

    // Retry edits that never reached the sheet.
    const pending = await prisma.prospect.findMany({ where: { sourceId, dirty: true, sheetRow: { not: null } } });
    for (const p of pending) await writeBackProspect(p, source);

    return { ...result, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[prospects] Sync failed for", sourceId, message);
    await prisma.prospectSource
      .update({ where: { id: sourceId }, data: { lastSyncError: message.slice(0, 500) } })
      .catch(() => undefined);
    return { ...result, error: message };
  }
}

export interface WriteBackResult {
  ok: boolean;
  /** Fields that could not be written because the sheet has no matching column. */
  missingColumns: string[];
  error?: string;
}

/**
 * Writes the editable fields of one prospect back to its sheet row. The row is
 * found by its RIDGE ID (not its row number), so it is safe even if rows were
 * moved since the last sync. Updates `dirty` / `writeBackError` on the prospect.
 */
export async function writeBackProspect(prospect: Prospect, sourceArg?: ProspectSource): Promise<WriteBackResult> {
  const source = sourceArg ?? (await prisma.prospectSource.findUnique({ where: { id: prospect.sourceId } }));
  if (!source) return { ok: false, missingColumns: [], error: "Sheet connection not found." };

  try {
    const values = await readSheet(source.spreadsheetId, source.sheetTab);
    if (values.length === 0) throw new Error("The sheet is empty.");

    const headers = values[0].map((h) => h.trim());
    const { mapping } = resolveColumns(headers, asManualMap(source.columnMap));
    const idCol = mapping.externalId;
    if (idCol === undefined) throw new Error('The sheet has no "RIDGE ID" column yet. Sync first.');

    const rowIndex = values.findIndex((row, i) => i > 0 && (row[idCol] ?? "").trim() === prospect.externalId);
    if (rowIndex < 0) throw new Error("This person's row is no longer in the sheet.");
    const row = values[rowIndex];

    const updates: CellUpdate[] = [];
    const missingColumns: string[] = [];

    const push = (key: ProspectFieldKey, label: string, value: string) => {
      const col = mapping[key];
      if (col === undefined) {
        missingColumns.push(label);
        return;
      }
      if ((row[col] ?? "") === value) return; // unchanged
      updates.push({ row: rowIndex + 1, col, value });
    };

    push("callRequested", "Request for Call", prospect.callRequested ?? "");
    push("callSchedule", "Time Schedule for Call", prospect.callSchedule ?? "");
    push("callCompleted", "Call Completed", formatBoolForSheet(prospect.callCompleted, row[mapping.callCompleted ?? -1]));
    push("callFeedback", "Feedback from Call", prospect.callFeedback ?? "");
    push("followUpRequired", "Follow-up Call Required?", formatBoolForSheet(prospect.followUpRequired, row[mapping.followUpRequired ?? -1]));
    push("confirmation", "Confirmation", prospect.confirmation ?? "");

    await updateCells(source.spreadsheetId, source.sheetTab, updates);
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: { dirty: false, writeBackError: null, sheetRow: rowIndex + 1 },
    });
    return { ok: true, missingColumns };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[prospects] Write-back failed for", prospect.id, message);
    await prisma.prospect
      .update({ where: { id: prospect.id }, data: { dirty: true, writeBackError: message.slice(0, 500) } })
      .catch(() => undefined);
    return { ok: false, missingColumns: [], error: message };
  }
}
