"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { useIsOwner } from "@/lib/useIsOwner";

interface Prospect {
  id: string;
  sourceId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  callRequested: string | null;
  callSchedule: string | null;
  callCompleted: boolean;
  callFeedback: string | null;
  followUpRequired: boolean;
  confirmation: string | null;
  extra: Record<string, string> | null;
  inSheet: boolean;
  dirty: boolean;
  writeBackError: string | null;
  registrationId: string | null;
  createdAt: string;
}

interface Source {
  id: string;
  name: string;
  sheetTab: string;
  spreadsheetId: string;
  active: boolean;
  hasManualMapping: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

type Filter = "ALL" | "CALL_REQUESTED" | "TO_CALL" | "FOLLOW_UP" | "CONVERTED";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "CALL_REQUESTED", label: "Wants a call" },
  { value: "TO_CALL", label: "Call not done" },
  { value: "FOLLOW_UP", label: "Follow-up needed" },
  { value: "CONVERTED", label: "Registered" },
];

const inputClass =
  "w-full bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold";
const labelClass = "block text-xs uppercase tracking-wider text-muted mb-2";
const goldButton =
  "text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest disabled:opacity-60";
const ghostButton = "text-sm px-4 py-2.5 rounded-full border border-border text-muted hover:text-fg disabled:opacity-60";

const DEFAULT_CALL_OPTIONS = ["Yes", "No"];

function isYes(value: string | null): boolean {
  return ["yes", "y", "true", "requested"].includes((value ?? "").trim().toLowerCase());
}

export default function ProspectsPage() {
  const isOwner = useIsOwner();
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [configured, setConfigured] = useState(true);
  const [serviceEmail, setServiceEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const [filter, setFilter] = useState<Filter>("ALL");
  const [sourceFilter, setSourceFilter] = useState("");
  const [query, setQuery] = useState("");

  const [editing, setEditing] = useState<Prospect | null>(null);
  const [converting, setConverting] = useState<Prospect | null>(null);
  const [viewing, setViewing] = useState<Prospect | null>(null);
  const [mappingFor, setMappingFor] = useState<Source | null>(null);
  const [showSources, setShowSources] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/prospects");
      if (!res.ok) return;
      const data = await res.json();
      setProspects(data.prospects);
      setSources(data.sources);
      setConfigured(data.configured);
      setServiceEmail(data.serviceAccountEmail);
    } catch {
      // keep showing the last data; the next poll retries
    } finally {
      setLoading(false);
    }
  }, []);

  const sync = useCallback(
    async (force = false) => {
      setSyncing(true);
      try {
        const res = await fetch("/api/admin/prospects/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        });
        const data = await res.json().catch(() => ({}));
        const failed = (data.results ?? []).find((r: { ok: boolean; error?: string }) => !r.ok);
        if (force) {
          setNotice(failed ? { text: failed.error || "Sync failed.", ok: false } : { text: "Synced with the sheet.", ok: true });
        }
      } catch {
        if (force) setNotice({ text: "Couldn't reach the server.", ok: false });
      } finally {
        setSyncing(false);
        await load();
      }
    },
    [load]
  );

  // First visit: show what we have, then pull from the sheet.
  useEffect(() => {
    load().then(() => sync(false));
  }, [load, sync]);

  // Keep in step with the sheet while the tab is open (the server skips syncs that are too close together).
  useAutoRefresh(() => sync(false), 60_000);

  const callOptions = useMemo(() => {
    const set = new Set(DEFAULT_CALL_OPTIONS);
    prospects.forEach((p) => p.callRequested && set.add(p.callRequested));
    return Array.from(set);
  }, [prospects]);

  const sourceName = useMemo(() => new Map(sources.map((s) => [s.id, s.name])), [sources]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return prospects.filter((p) => {
      if (sourceFilter && p.sourceId !== sourceFilter) return false;
      if (filter === "CALL_REQUESTED" && !isYes(p.callRequested)) return false;
      if (filter === "TO_CALL" && (p.callCompleted || !isYes(p.callRequested))) return false;
      if (filter === "FOLLOW_UP" && !p.followUpRequired) return false;
      if (filter === "CONVERTED" && !p.registrationId) return false;
      if (q && ![p.fullName, p.email, p.phone].some((v) => (v ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [prospects, filter, sourceFilter, query]);

  const lastSynced = sources.map((s) => s.lastSyncedAt).filter(Boolean).sort().pop();
  const syncError = sources.find((s) => s.lastSyncError)?.lastSyncError;

  return (
    <AdminShell active="/admin/prospects">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-serif text-2xl">Prospects</h2>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            People who asked for a call before registering. This list comes from your Google Sheet: edits made
            here go back to the sheet, and changes in the sheet show up here.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {lastSynced && (
            <span className="text-xs text-muted">Last synced {new Date(lastSynced).toLocaleTimeString()}</span>
          )}
          <button onClick={() => sync(true)} disabled={syncing || sources.length === 0} className={ghostButton}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <button onClick={() => setShowSources((v) => !v)} className={ghostButton}>
            {showSources ? "Hide sheets" : "Sheets"}
          </button>
        </div>
      </div>

      {!configured && (
        <div className="border border-amber-400/40 rounded-xl p-4 mb-6 text-sm">
          <p className="text-amber-300 mb-1">Google access isn&apos;t set up on the server yet.</p>
          <p className="text-muted">
            Add <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> (or <code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code> and{" "}
            <code>GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY</code>) to the environment, then share your sheet with the
            service account as an Editor.
          </p>
        </div>
      )}

      {notice && <p className={`text-sm mb-4 ${notice.ok ? "text-goldlight" : "text-red-400"}`}>{notice.text}</p>}
      {syncError && !notice && <p className="text-sm mb-4 text-red-400">Last sync problem: {syncError}</p>}

      {(showSources || (!loading && sources.length === 0)) && (
        <SourcesPanel
          sources={sources}
          isOwner={isOwner}
          serviceEmail={serviceEmail}
          onChanged={() => load()}
          onMatch={(s) => setMappingFor(s)}
          onNotice={setNotice}
        />
      )}

      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`text-sm px-4 py-2 rounded-full border transition-colors whitespace-nowrap ${
              filter === f.value ? "border-gold text-goldlight bg-gold/10" : "border-border text-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex gap-3 mb-6 flex-wrap">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email or phone"
          className={`${inputClass} max-w-xs`}
        />
        {sources.length > 1 && (
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={`${inputClass} max-w-[14rem]`}>
            <option value="">All sheets</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="table-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                <th className="px-5 py-3 font-medium whitespace-nowrap">Full Name</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Request for Call</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Time Schedule for Call</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Call Completed</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Feedback from Call</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Follow-up Call Required?</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Confirmation</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted">
                    {prospects.length === 0 ? "No prospects yet. Connect a sheet under Sheets." : "Nobody matches these filters."}
                  </td>
                </tr>
              )}
              {visible.map((p) => (
                <tr key={p.id} className="border-b border-border/50 last:border-b-0 align-top">
                  <td className="px-5 py-4 whitespace-nowrap">
                    <button onClick={() => setViewing(p)} className="font-medium hover:text-goldlight text-left">
                      {p.fullName}
                    </button>
                    <div className="text-xs text-muted mt-0.5">
                      {[p.phone, sources.length > 1 ? sourceName.get(p.sourceId) : null].filter(Boolean).join(" · ")}
                    </div>
                    {p.dirty && (
                      <div className="text-xs text-amber-300 mt-1" title={p.writeBackError ?? ""}>
                        Not saved to the sheet yet
                      </div>
                    )}
                    {!p.inSheet && <div className="text-xs text-muted mt-1">Removed from the sheet</div>}
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">{p.callRequested || <span className="text-muted">-</span>}</td>
                  <td className="px-5 py-4 whitespace-nowrap text-muted">{p.callSchedule || "-"}</td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    {p.callCompleted ? <span className="text-emerald-400">Yes</span> : <span className="text-muted">No</span>}
                  </td>
                  <td className="px-5 py-4 text-muted max-w-xs">
                    <div className="line-clamp-2 whitespace-pre-wrap">{p.callFeedback || "-"}</div>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    {p.followUpRequired ? <span className="text-amber-300">Yes</span> : <span className="text-muted">No</span>}
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    {p.registrationId ? (
                      <span className="text-emerald-400">Registered</span>
                    ) : (
                      p.confirmation || <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap text-right space-x-4">
                    <button onClick={() => setEditing(p)} className="text-goldlight hover:underline">
                      Update
                    </button>
                    {p.phone && (
                      <Link href={`/admin/whatsapp?to=${encodeURIComponent(p.phone)}&name=${encodeURIComponent(p.fullName)}`} className="text-goldlight hover:underline">
                        WhatsApp
                      </Link>
                    )}
                    {!p.registrationId && (
                      <button onClick={() => setConverting(p)} className="text-goldlight hover:underline">
                        Register
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {viewing && <DetailsDialog prospect={viewing} sourceName={sourceName.get(viewing.sourceId)} onClose={() => setViewing(null)} />}
      {editing && (
        <EditDialog
          prospect={editing}
          callOptions={callOptions}
          onClose={() => setEditing(null)}
          onSaved={(n) => {
            setEditing(null);
            setNotice(n);
            load();
          }}
        />
      )}
      {converting && (
        <ConvertDialog
          prospect={converting}
          onClose={() => setConverting(null)}
          onDone={(n) => {
            setConverting(null);
            setNotice(n);
            load();
          }}
        />
      )}
      {mappingFor && (
        <MappingDialog
          source={mappingFor}
          onClose={() => setMappingFor(null)}
          onSaved={() => {
            setMappingFor(null);
            setNotice({ text: "Column matching saved and the sheet was re-read.", ok: true });
            load();
          }}
        />
      )}
    </AdminShell>
  );
}

function Modal({ title, eyebrow, children, wide }: { title: string; eyebrow: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4 py-6 overflow-y-auto">
      <div className={`w-full ${wide ? "max-w-xl" : "max-w-md"} bg-cardbg border border-border rounded-2xl p-6 my-auto`}>
        <p className="text-xs uppercase tracking-wider text-muted mb-1">{eyebrow}</p>
        <h3 className="font-serif text-xl mb-5">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 text-sm cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#C9972E]" />
      {label}
    </label>
  );
}

function DetailsDialog({ prospect, sourceName, onClose }: { prospect: Prospect; sourceName?: string; onClose: () => void }) {
  const rows: [string, string | null][] = [
    ["Email", prospect.email],
    ["Phone", prospect.phone],
    ["Sheet", sourceName ?? null],
    ...Object.entries(prospect.extra ?? {}).map(([k, v]) => [k, v] as [string, string]),
  ];
  return (
    <Modal eyebrow="Prospect" title={prospect.fullName}>
      <div className="space-y-2 text-sm mb-6">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <span className="text-muted">{k}</span>
            <span className="text-right break-words">{v || "-"}</span>
          </div>
        ))}
        {prospect.callFeedback && (
          <div className="pt-3">
            <div className="text-muted mb-1">Feedback from call</div>
            <p className="whitespace-pre-wrap">{prospect.callFeedback}</p>
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <button onClick={onClose} className={ghostButton}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function EditDialog({
  prospect,
  callOptions,
  onClose,
  onSaved,
}: {
  prospect: Prospect;
  callOptions: string[];
  onClose: () => void;
  onSaved: (notice: { text: string; ok: boolean }) => void;
}) {
  const [callRequested, setCallRequested] = useState(prospect.callRequested ?? "");
  const [callSchedule, setCallSchedule] = useState(prospect.callSchedule ?? "");
  const [callCompleted, setCallCompleted] = useState(prospect.callCompleted);
  const [callFeedback, setCallFeedback] = useState(prospect.callFeedback ?? "");
  const [followUpRequired, setFollowUpRequired] = useState(prospect.followUpRequired);
  const [confirmation, setConfirmation] = useState(prospect.confirmation ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/prospects/${prospect.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callRequested, callSchedule, callCompleted, callFeedback, followUpRequired, confirmation }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save.");
      if (data.sheetUpdated) {
        const missing: string[] = data.missingColumns ?? [];
        onSaved({
          text: missing.length ? `Saved. The sheet has no column for: ${missing.join(", ")}.` : "Saved and updated in the sheet.",
          ok: true,
        });
      } else {
        onSaved({ text: `Saved here, but the sheet wasn't updated: ${data.sheetError}. It will retry on the next sync.`, ok: false });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
      setSubmitting(false);
    }
  }

  return (
    <Modal eyebrow="Update prospect" title={prospect.fullName} wide>
      <div className="grid gap-4 md:grid-cols-2 mb-4">
        <div>
          <label className={labelClass}>Request for Call</label>
          <select value={callRequested} onChange={(e) => setCallRequested(e.target.value)} className={inputClass}>
            <option value="">Not set</option>
            {callOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Time Schedule for Call</label>
          <input value={callSchedule} onChange={(e) => setCallSchedule(e.target.value)} placeholder="e.g. 2 Oct 2026, 4:00 PM" className={inputClass} />
        </div>
      </div>
      <div className="mb-4">
        <label className={labelClass}>Feedback from Call</label>
        <textarea value={callFeedback} onChange={(e) => setCallFeedback(e.target.value)} rows={4} className={inputClass} />
      </div>
      <div className="mb-4">
        <label className={labelClass}>Confirmation</label>
        <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className={inputClass} />
      </div>
      <div className="flex gap-8 flex-wrap mb-2">
        <Toggle label="Call completed" checked={callCompleted} onChange={setCallCompleted} />
        <Toggle label="Follow-up call required" checked={followUpRequired} onChange={setFollowUpRequired} />
      </div>
      {error && <p className="text-sm text-red-400 mt-4">{error}</p>}
      <div className="flex items-center justify-end gap-3 mt-6">
        <button onClick={onClose} disabled={submitting} className={ghostButton}>
          Cancel
        </button>
        <button onClick={save} disabled={submitting} className={goldButton}>
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function ConvertDialog({
  prospect,
  onClose,
  onDone,
}: {
  prospect: Prospect;
  onClose: () => void;
  onDone: (notice: { text: string; ok: boolean }) => void;
}) {
  const [email, setEmail] = useState(prospect.email ?? "");
  const [phone, setPhone] = useState(prospect.phone ?? "");
  const [country, setCountry] = useState("");
  const [organization, setOrganization] = useState("");
  const [regType, setRegType] = useState<"early_bird" | "late">("early_bird");
  const [sendConfirmation, setSendConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/prospects/${prospect.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone, country, organization, regType, sendConfirmation }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to register.");
      onDone({
        text: data.emailError
          ? `${prospect.fullName} is registered, but the confirmation email failed: ${data.emailError}`
          : `${prospect.fullName} is now registered.`,
        ok: !data.emailError,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register.");
      setSubmitting(false);
    }
  }

  return (
    <Modal eyebrow="Register this prospect" title={prospect.fullName} wide>
      <p className="text-sm text-muted mb-5">Fill in what the registration needs. Email, phone and country are required.</p>
      <div className="grid gap-4 md:grid-cols-2 mb-4">
        <div>
          <label className={labelClass}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Country</label>
          <input value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Organization (optional)</label>
          <input value={organization} onChange={(e) => setOrganization(e.target.value)} className={inputClass} />
        </div>
      </div>
      <div className="mb-4">
        <label className={labelClass}>Registration type</label>
        <select value={regType} onChange={(e) => setRegType(e.target.value as "early_bird" | "late")} className={inputClass}>
          <option value="early_bird">Early Bird</option>
          <option value="late">Late</option>
        </select>
      </div>
      <Toggle label="Send the registration confirmation email now" checked={sendConfirmation} onChange={setSendConfirmation} />
      {error && <p className="text-sm text-red-400 mt-4">{error}</p>}
      <div className="flex items-center justify-end gap-3 mt-6">
        <button onClick={onClose} disabled={submitting} className={ghostButton}>
          Cancel
        </button>
        <button onClick={submit} disabled={submitting || !email || !phone || !country} className={goldButton}>
          {submitting ? "Registering…" : "Register"}
        </button>
      </div>
    </Modal>
  );
}

interface FieldMatch {
  key: string;
  label: string;
  matchedHeader: string | null;
  how: "manual" | "exact" | "similar" | null;
  manual: string;
}

function MappingDialog({ source, onClose, onSaved }: { source: Source; onClose: () => void; onSaved: () => void }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [fields, setFields] = useState<FieldMatch[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/prospects/sources/${source.id}/columns`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't read the sheet.");
        setHeaders(data.headers);
        setFields(data.fields);
        setChoices(Object.fromEntries(data.fields.map((f: FieldMatch) => [f.key, f.manual || f.matchedHeader || ""])));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't read the sheet."))
      .finally(() => setLoading(false));
  }, [source.id]);

  async function save() {
    setSubmitting(true);
    setError(null);
    // Only save a choice as an override if it differs from what auto-matching found.
    const columnMap: Record<string, string> = {};
    for (const f of fields) {
      const chosen = choices[f.key] ?? "";
      if (chosen && chosen !== f.matchedHeader) columnMap[f.key] = chosen;
      else if (chosen && f.how === "manual") columnMap[f.key] = chosen;
    }
    try {
      const res = await fetch(`/api/admin/prospects/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnMap }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
      setSubmitting(false);
    }
  }

  return (
    <Modal eyebrow="Match columns" title={source.name} wide>
      <p className="text-sm text-muted mb-5">
        Columns are matched by their names automatically. If your sheet uses different names (for example a
        marketing lead sheet), pick the right column for each field here. Columns that match nothing are kept
        and shown in the prospect&apos;s details.
      </p>
      {loading && <p className="text-muted text-sm">Reading the sheet…</p>}
      {!loading && (
        <div className="space-y-3">
          {fields.map((f) => (
            <div key={f.key} className="grid grid-cols-2 gap-3 items-center">
              <div className="text-sm">
                {f.label}
                {f.key === "externalId" && <span className="block text-xs text-muted">Added automatically if missing</span>}
              </div>
              <select
                value={choices[f.key] ?? ""}
                onChange={(e) => setChoices((c) => ({ ...c, [f.key]: e.target.value }))}
                className={inputClass}
              >
                <option value="">{f.key === "externalId" ? "Create automatically" : "Not in this sheet"}</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-400 mt-4">{error}</p>}
      <div className="flex items-center justify-end gap-3 mt-6">
        <button onClick={onClose} disabled={submitting} className={ghostButton}>
          Cancel
        </button>
        <button onClick={save} disabled={submitting || loading || headers.length === 0} className={goldButton}>
          {submitting ? "Saving…" : "Save matching"}
        </button>
      </div>
    </Modal>
  );
}

function SourcesPanel({
  sources,
  isOwner,
  serviceEmail,
  onChanged,
  onMatch,
  onNotice,
}: {
  sources: Source[];
  isOwner: boolean;
  serviceEmail: string | null;
  onChanged: () => void;
  onMatch: (s: Source) => void;
  onNotice: (n: { text: string; ok: boolean }) => void;
}) {
  const [name, setName] = useState("");
  const [spreadsheet, setSpreadsheet] = useState("");
  const [sheetTab, setSheetTab] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/prospects/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, spreadsheet, sheetTab }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to connect.");
      setName("");
      setSpreadsheet("");
      setSheetTab("");
      onNotice(
        data.sync?.ok
          ? { text: `Connected. ${data.sync.created} people imported.`, ok: true }
          : { text: `Connected, but the first sync failed: ${data.sync?.error}`, ok: false }
      );
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect.");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(s: Source) {
    if (!window.confirm(`Disconnect "${s.name}"? Its prospects are removed from this dashboard. The sheet and any registrations are not touched.`)) return;
    const res = await fetch(`/api/admin/prospects/sources/${s.id}`, { method: "DELETE" });
    if (res.ok) onChanged();
    else onNotice({ text: "Couldn't disconnect the sheet.", ok: false });
  }

  async function togglePause(s: Source) {
    await fetch(`/api/admin/prospects/sources/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !s.active }),
    });
    onChanged();
  }

  return (
    <div className="border border-border rounded-xl p-6 mb-8">
      <h3 className="font-serif text-xl mb-1">Connected sheets</h3>
      <p className="text-sm text-muted mb-5">
        Share each Google Sheet with{" "}
        <span className="text-fg break-all">{serviceEmail ?? "the service account email"}</span> as an Editor. The
        first row of the tab must be the column headings. A &quot;RIDGE ID&quot; column is added on the right so
        each row can be found again.
      </p>

      {sources.length > 0 && (
        <div className="space-y-3 mb-6">
          {sources.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-4 flex-wrap border border-border/60 rounded-lg px-4 py-3">
              <div className="text-sm">
                <span className="font-medium">{s.name}</span>
                <span className="text-muted"> · tab &quot;{s.sheetTab}&quot;</span>
                {!s.active && <span className="ml-2 text-xs rounded-full border border-border px-2 py-0.5 text-muted">Paused</span>}
                {s.hasManualMapping && <span className="ml-2 text-xs rounded-full border border-border px-2 py-0.5 text-muted">Custom matching</span>}
                {s.lastSyncError && <div className="text-xs text-red-400 mt-1">{s.lastSyncError}</div>}
              </div>
              {isOwner && (
                <div className="flex items-center gap-4 text-sm">
                  <button onClick={() => onMatch(s)} className="text-goldlight hover:underline">
                    Match columns
                  </button>
                  <button onClick={() => togglePause(s)} className="text-muted hover:text-fg">
                    {s.active ? "Pause" : "Resume"}
                  </button>
                  <button onClick={() => remove(s)} className="text-red-400 hover:underline">
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isOwner ? (
        <>
          <p className="text-xs uppercase tracking-wider text-muted mb-3">Connect a sheet</p>
          <div className="grid gap-4 md:grid-cols-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Prospects" className={inputClass} />
            <input value={spreadsheet} onChange={(e) => setSpreadsheet(e.target.value)} placeholder="Google Sheet link or id" className={inputClass} />
            <input value={sheetTab} onChange={(e) => setSheetTab(e.target.value)} placeholder="Tab name, e.g. Sheet1" className={inputClass} />
          </div>
          {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
          <button onClick={add} disabled={submitting || !name || !spreadsheet || !sheetTab} className={`${goldButton} mt-4`}>
            {submitting ? "Connecting…" : "Connect sheet"}
          </button>
        </>
      ) : (
        sources.length === 0 && <p className="text-sm text-muted">Ask an owner to connect the prospects sheet.</p>
      )}
    </div>
  );
}
