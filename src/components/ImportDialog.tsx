"use client";

import { cacheDeletePrefix } from "@/lib/clientCache";
import { useRef, useState } from "react";
import { IMPORT_FIELDS, type ImportField } from "@/lib/csvImport";
import { ghostButton, inputClass, primaryButton } from "@/components/ui";

interface Problem {
  rowNumber: number;
  name?: string;
  reason: string;
}
interface Preview {
  headers: string[];
  mapping: Record<string, ImportField>;
  sample: Record<string, string>[];
  totalRows: number;
  willAdd: number;
  alreadyOnList: number;
  problems: Problem[];
  problemCount: number;
}
interface Done {
  added: number;
  updated: number;
  skipped: number;
  problemCount: number;
  problems: Problem[];
}

/** Upload a CSV, check how its columns were understood, then load it. Nothing is emailed. */
export default function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportField>>({});
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "update">("skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  async function send(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/registrations/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPreview(null);
    setDone(null);
    if (file.size > 4 * 1024 * 1024) return setError("That file is larger than 4 MB. Split it into smaller files and import them one after the other.");
    if (/\.xlsx?$/i.test(file.name)) return setError("That is an Excel file. In Excel choose File → Save As → CSV, then upload the CSV.");
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    setBusy(true);
    const { ok, json } = await send({ csv: text, dryRun: true });
    setBusy(false);
    if (!ok && !json.headers) return setError(json.error || "The file could not be read.");
    setPreview(json as Preview);
    setMapping(json.mapping);
    if (!ok) setError(json.error);
  }

  async function recheck(next: Record<string, ImportField>) {
    setMapping(next);
    if (!csv) return;
    const { ok, json } = await send({ csv, mapping: next, dryRun: true, onDuplicate });
    if (json.headers) setPreview(json as Preview);
    setError(ok ? null : json.error);
  }

  async function runImport() {
    if (!csv) return;
    setBusy(true);
    setError(null);
    const { ok, json } = await send({ csv, mapping, onDuplicate });
    setBusy(false);
    if (!ok) return setError(json.error || "The import failed.");
    setDone(json as Done);
    cacheDeletePrefix("/api/admin/registrations?");
    cacheDeletePrefix("/api/admin/overview");
    onImported();
  }

  const canImport = preview && preview.willAdd + (onDuplicate === "update" ? preview.alreadyOnList : 0) > 0 && !error;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-pagebg border border-border rounded-2xl w-full max-w-3xl my-8 p-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Import guests">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="font-serif text-2xl">Import guests from a CSV</h3>
            <p className="text-sm text-muted mt-1">Nobody is emailed when you import. You send invitations yourself, later.</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg text-3xl leading-none" aria-label="Close">
            ×
          </button>
        </div>

        {done ? (
          <div>
            <div className="border border-gold/50 bg-gold/10 rounded-xl p-5 mb-4">
              <p className="font-semibold mb-1">Import finished</p>
              <p className="text-sm">
                {done.added} added{done.updated ? `, ${done.updated} updated` : ""}
                {done.skipped ? `, ${done.skipped} already on the list (left as they were)` : ""}
                {done.problemCount ? `, ${done.problemCount} row${done.problemCount === 1 ? "" : "s"} could not be used` : ""}.
              </p>
            </div>
            {done.problems.length > 0 && <ProblemList problems={done.problems} total={done.problemCount} />}
            <button onClick={onClose} className={`${primaryButton} mt-4`}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div
              className="border-2 border-dashed border-border rounded-xl p-6 text-center mb-5 hover:border-gold transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                chooseFile(e.dataTransfer.files?.[0]);
              }}
            >
              <input ref={fileRef} type="file" accept=".csv,text/csv,.txt,.tsv" className="hidden" onChange={(e) => chooseFile(e.target.files?.[0])} />
              <p className="text-sm mb-3">{fileName ? <strong>{fileName}</strong> : "Drop your CSV file here, or choose it from your computer."}</p>
              <button onClick={() => fileRef.current?.click()} className={ghostButton} disabled={busy}>
                {fileName ? "Choose a different file" : "Choose CSV file"}
              </button>
              <p className="text-xs text-muted mt-3">
                The first row must be the column names. Useful columns: name, email, phone, follow-up status and call feedback (feedback becomes the first entry in the guest's follow-up log). Any other column is kept on the guest&apos;s record.
              </p>
            </div>

            {busy && !preview && <p className="text-sm text-muted mb-4">Reading the file…</p>}
            {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

            {preview && (
              <>
                <h4 className="text-xs uppercase tracking-wider text-muted mb-2">How your columns were read</h4>
                <p className="text-xs text-muted mb-3">Change any column that was understood wrongly.</p>
                <div className="border border-border rounded-xl overflow-hidden mb-5">
                  <div className="table-scroll overflow-x-auto max-h-80">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                          <th className="px-4 py-2.5 font-medium">Column in your file</th>
                          <th className="px-4 py-2.5 font-medium">Example</th>
                          <th className="px-4 py-2.5 font-medium">Goes to</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.headers.map((h) => (
                          <tr key={h} className="border-b border-border/50 last:border-b-0">
                            <td className="px-4 py-2.5 font-medium">{h}</td>
                            <td className="px-4 py-2.5 text-muted max-w-[14rem] truncate">{preview.sample.map((r) => r[h]).find(Boolean) || "-"}</td>
                            <td className="px-4 py-2.5">
                              <select value={mapping[h] ?? "extra"} onChange={(e) => recheck({ ...mapping, [h]: e.target.value as ImportField })} className={`${inputClass} py-1.5`}>
                                {IMPORT_FIELDS.map((f) => (
                                  <option key={f.value} value={f.value}>
                                    {f.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {!error && (
                  <>
                    <div className="grid grid-cols-3 gap-3 mb-4 text-center">
                      <div className="border border-border rounded-xl py-3">
                        <p className="font-serif text-2xl text-goldlight">{preview.willAdd}</p>
                        <p className="text-xs text-muted">new guests</p>
                      </div>
                      <div className="border border-border rounded-xl py-3">
                        <p className="font-serif text-2xl">{preview.alreadyOnList}</p>
                        <p className="text-xs text-muted">already on the list</p>
                      </div>
                      <div className="border border-border rounded-xl py-3">
                        <p className={`font-serif text-2xl ${preview.problemCount ? "text-amber-300" : ""}`}>{preview.problemCount}</p>
                        <p className="text-xs text-muted">can&apos;t be used</p>
                      </div>
                    </div>

                    {preview.alreadyOnList > 0 && (
                      <fieldset className="mb-4 text-sm">
                        <legend className="text-xs uppercase tracking-wider text-muted mb-2">Guests whose email is already on the list</legend>
                        {(
                          [
                            ["skip", "Leave them as they are"],
                            ["update", "Fill in anything new from this file (never blanks anything, never touches a reservation)"],
                          ] as const
                        ).map(([value, label]) => (
                          <label key={value} className="flex items-start gap-2.5 py-1 cursor-pointer">
                            <input type="radio" name="dup" checked={onDuplicate === value} onChange={() => setOnDuplicate(value)} className="mt-1 accent-lime-500" />
                            <span>{label}</span>
                          </label>
                        ))}
                      </fieldset>
                    )}

                    {preview.problems.length > 0 && <ProblemList problems={preview.problems} total={preview.problemCount} />}
                  </>
                )}

                <div className="flex items-center gap-3 mt-5">
                  <button onClick={onClose} className={ghostButton}>
                    Cancel
                  </button>
                  <button onClick={runImport} disabled={!canImport || busy} className={primaryButton}>
                    {busy ? "Importing…" : `Import ${preview.willAdd + (onDuplicate === "update" ? preview.alreadyOnList : 0)} guest${preview.willAdd + (onDuplicate === "update" ? preview.alreadyOnList : 0) === 1 ? "" : "s"}`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ProblemList({ problems, total }: { problems: Problem[]; total: number }) {
  return (
    <details className="border border-border rounded-xl px-4 py-3 text-sm mb-2">
      <summary className="cursor-pointer text-amber-300">
        {total} row{total === 1 ? "" : "s"} can&apos;t be imported (click to see why)
      </summary>
      <ul className="mt-3 space-y-1.5 max-h-48 overflow-y-auto">
        {problems.map((p) => (
          <li key={p.rowNumber} className="text-muted">
            <span className="text-fg">Row {p.rowNumber}</span>
            {p.name ? ` (${p.name})` : ""}: {p.reason}
          </li>
        ))}
        {total > problems.length && <li className="text-muted">…and {total - problems.length} more.</li>}
      </ul>
    </details>
  );
}
