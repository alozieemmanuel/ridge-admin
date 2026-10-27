"use client";

import { useEffect, useState } from "react";
import { cacheDeletePrefix } from "@/lib/clientCache";
import { useIsOwner } from "@/lib/useIsOwner";
import { formatDateTime, ghostButton, inputClass, primaryButton } from "@/components/ui";

interface LastSync {
  at: string;
  ok: boolean;
  error?: string;
  rows?: number;
  added?: number;
  updated?: number;
  unchanged?: number;
  problemCount?: number;
}
interface Problem {
  rowNumber: number;
  name?: string;
  reason: string;
}

/** Where the live Google Sheet link is kept. Sync reads the sheet and adds or updates contacts by email. Nobody is emailed. */
export default function SheetSyncDialog({ onClose, onSynced }: { onClose: () => void; onSynced: () => void }) {
  const isOwner = useIsOwner();
  const [url, setUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [last, setLast] = useState<LastSync | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "sync" | "replace" | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [replace, setReplace] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pingUrl, setPingUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/admin/registrations/sheet", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setUrl(data.url ?? "");
        setSavedUrl(data.url ?? "");
        setLast(data.lastSync ?? null);
        setPingUrl(data.ping?.url ?? "");
      })
      .catch(() => setMessage({ text: "Couldn't load the saved link.", ok: false }))
      .finally(() => setLoading(false));
  }, []);

  function refreshLists() {
    cacheDeletePrefix("/api/admin/registrations?");
    cacheDeletePrefix("/api/admin/overview");
    onSynced();
  }

  async function save() {
    setBusy("save");
    setMessage(null);
    const res = await fetch("/api/admin/registrations/sheet", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res || !res.ok) return setMessage({ text: json.error || "Couldn't save the link.", ok: false });
    setSavedUrl(json.url ?? "");
    setLast(json.lastSync ?? null);
    setPingUrl(json.ping?.url ?? "");
    setMessage({ text: url.trim() ? "Link saved." : "Link removed.", ok: true });
  }

  async function sync(withReplace: boolean) {
    setBusy(withReplace ? "replace" : "sync");
    setMessage(null);
    setProblems([]);
    const res = await fetch("/api/admin/registrations/sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withReplace ? { replace: true, confirm: confirmText } : {}),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res || !res.ok) {
      setMessage({ text: json.error || "Couldn't reach the server. Try again.", ok: false });
      setLast({ at: new Date().toISOString(), ok: false, error: json.error });
      return;
    }
    setLast(json as LastSync);
    setProblems(json.problems ?? []);
    setMessage({ text: `Synced. ${json.added} added, ${json.updated} updated, ${json.unchanged} already up to date.`, ok: true });
    if (withReplace) {
      setReplace(false);
      setConfirmText("");
    }
    refreshLists();
  }


  const script = `// Instant updates: tells the dashboard the moment someone registers.
const DASHBOARD_PING_URL = '${pingUrl}';

function pingDashboard() {
  try {
    SpreadsheetApp.flush(); // make sure the new row is saved before the dashboard reads the sheet
    UrlFetchApp.fetch(DASHBOARD_PING_URL, { method: 'post', muteHttpExceptions: true });
  } catch (err) {
    console.error('Dashboard ping failed: ' + err);
  }
}`;

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ text: "Couldn't copy. Select the code and copy it by hand.", ok: false });
    }
  }

  const linked = Boolean(savedUrl);
  const dirty = url.trim() !== savedUrl;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-pagebg border border-border rounded-2xl w-full max-w-2xl my-8 p-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Live sheet">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="font-serif text-2xl">Live Google Sheet</h3>
            <p className="text-sm text-muted mt-1">Paste the link to your sheet. Contacts are added and updated by email. Nobody is emailed.</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg text-3xl leading-none" aria-label="Close">
            ×
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <label className="block text-xs uppercase tracking-wider text-muted mb-2" htmlFor="sheet-url">
              Sheet link
            </label>
            <input id="sheet-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className={inputClass} />
            <p className="text-xs text-muted mt-2">
              In the sheet choose Share, then General access, then Anyone with the link as Viewer. The first row must be the column names, with at least a name and an email. If the data is on another tab, open that tab
              first and copy the link from the address bar.
            </p>

            <div className="flex flex-wrap gap-3 mt-4">
              <button onClick={save} disabled={busy !== null || !dirty} className={ghostButton}>
                {busy === "save" ? "Saving…" : "Save link"}
              </button>
              <button onClick={() => sync(false)} disabled={busy !== null || !linked || dirty} className={primaryButton}>
                {busy === "sync" ? "Syncing…" : "Sync now"}
              </button>
            </div>
            {linked && dirty && <p className="text-xs text-muted mt-2">Save the new link before syncing.</p>}

            {message && (
              <p className={`text-sm mt-4 rounded-lg border px-4 py-2.5 ${message.ok ? "border-gold/50 bg-gold/10" : "border-red-400/50 text-red-400"}`} role="status">
                {message.text}
              </p>
            )}

            {linked && (
              <p className="text-xs text-muted mt-4">
                {last
                  ? last.ok
                    ? `Last synced ${formatDateTime(last.at)}: ${last.rows ?? 0} rows read, ${last.added ?? 0} added, ${last.updated ?? 0} updated${last.problemCount ? `, ${last.problemCount} rows could not be used` : ""}.`
                    : `Last attempt ${formatDateTime(last.at)} failed: ${last.error ?? "unknown error"}`
                  : "Not synced yet."}{" "}
                While this page is open it syncs again every 5 minutes.
              </p>
            )}

            {problems.length > 0 && (
              <details className="border border-border rounded-xl px-4 py-3 text-sm mt-4">
                <summary className="cursor-pointer text-amber-300">
                  {last?.problemCount ?? problems.length} row{(last?.problemCount ?? problems.length) === 1 ? "" : "s"} could not be used (click to see why)
                </summary>
                <ul className="mt-3 space-y-1.5 max-h-48 overflow-y-auto">
                  {problems.map((p) => (
                    <li key={p.rowNumber} className="text-muted">
                      <span className="text-fg">Row {p.rowNumber}</span>
                      {p.name ? ` (${p.name})` : ""}: {p.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {isOwner && linked && pingUrl && (
              <div className="border border-border rounded-xl p-4 mt-6">
                <h4 className="font-medium text-sm">Instant updates</h4>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  Without this, new rows arrive within a few minutes. With it, your sheet&apos;s script tells the dashboard the moment someone registers, and they show up within seconds. It works next to the script you already have.
                </p>
                <ol className="text-xs text-muted mt-3 space-y-1.5 list-decimal pl-4 leading-relaxed">
                  <li>In the sheet open Extensions, then Apps Script.</li>
                  <li>Paste the code below at the very bottom of your script.</li>
                  <li>
                    Rename your function <code>handleRegistration</code> to <code>handleRegistrationCore</code>, then paste this above it:
                    <pre className="mt-1.5 bg-tint border border-border rounded-lg p-3 overflow-x-auto text-[11px] leading-relaxed text-fg">{`function handleRegistration(data) {
  const response = handleRegistrationCore(data);
  try {
    if (JSON.parse(response.getContent()).status === 'success') pingDashboard();
  } catch (err) {}
  return response;
}`}</pre>
                  </li>
                  <li>Deploy, then New version on your existing deployment, so the live address keeps working.</li>
                </ol>
                <pre className="mt-3 bg-tint border border-border rounded-lg p-3 overflow-x-auto text-[11px] leading-relaxed text-fg">{script}</pre>
                <button onClick={copyScript} className={`${ghostButton} mt-3`}>
                  {copied ? "Copied" : "Copy the code"}
                </button>
                <p className="text-[11px] text-muted mt-2">This address is private to this event. Keep it out of anything public.</p>
              </div>
            )}

            {isOwner && linked && (
              <div className="border border-red-400/40 rounded-xl p-4 mt-6">
                <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-1 accent-red-500" />
                  <span>
                    <span className="text-red-400 font-semibold">Replace everything.</span> Delete all current contacts, with their follow-up logs, email history and tickets, then load the sheet. The sheet is checked first, so a bad link
                    deletes nothing.
                  </span>
                </label>
                {replace && (
                  <div className="flex items-center gap-3 flex-wrap mt-3">
                    <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="Type DELETE" className="bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-red-400" />
                    <button
                      onClick={() => sync(true)}
                      disabled={busy !== null || dirty || confirmText !== "DELETE"}
                      className="text-sm px-5 py-2.5 rounded-full bg-red-500/90 text-white font-semibold uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {busy === "replace" ? "Replacing…" : "Delete and import"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="mt-6">
          <button onClick={onClose} className={ghostButton}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
