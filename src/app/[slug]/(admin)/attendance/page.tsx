"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEventPath, useTerms } from "@/lib/useEvent";
import AdminShell from "@/components/AdminShell";
import { Pill, PageHeader, StatCard, formatDateTime, ghostButton, inputClass, primaryButton } from "@/components/ui";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import InvitationPreviewDialog from "@/components/InvitationPreviewDialog";

interface Person {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  ticketCode: string | null;
  reservedAt: string | null;
  checkedInAt: string | null;
  ticketSentAt: string | null;
}
interface Data {
  capacity: number | null;
  invited: number;
  reserved: number;
  checkedIn: number;
  seatsLeft: number | null;
  people: Person[];
  scanned: Person | null;
  scanNotFound: boolean;
}

function AttendanceInner() {
  const ep = useEventPath();
  const { people, lpeople } = useTerms();
  const params = useSearchParams();
  const initialCode = params.get("code") ?? "";
  const [data, setData] = useState<Data | null>(null);
  const [code, setCode] = useState(initialCode);
  const [lookup, setLookup] = useState(initialCode);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "IN" | "NOT_IN">(params.get("filter") === "IN" ? "IN" : params.get("filter") === "NOT_IN" ? "NOT_IN" : "ALL");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [capacityInput, setCapacityInput] = useState("");
  const [editingCapacity, setEditingCapacity] = useState(false);
  const [previewing, setPreviewing] = useState<"invitation" | "reminder" | null>(null);
  const [bulk, setBulk] = useState<{ audience: "NOT_INVITED" | "INVITED_NOT_RESERVED"; count: number } | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const q = lookup ? `?code=${encodeURIComponent(lookup)}` : "";
    try {
      const res = await fetch(`/api/admin/attendance${q}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      // keep the last data
    }
  }, [lookup]);

  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(load, 10_000);

  const visible = useMemo(() => {
    if (!data) return [];
    const s = search.trim().toLowerCase();
    return data.people.filter((p) => {
      if (filter === "IN" && !p.checkedInAt) return false;
      if (filter === "NOT_IN" && p.checkedInAt) return false;
      if (!s) return true;
      return [p.fullName, p.email, p.phone, p.ticketCode ?? ""].some((v) => v.toLowerCase().includes(s));
    });
  }, [data, search, filter]);

  async function post(url: string, body: unknown, method = "POST") {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  }

  async function toggleCheckIn(p: Person) {
    setSavingId(p.id);
    setMessage(null);
    const { ok, json } = await post(`/api/admin/registrations/${p.id}/actions`, { action: p.checkedInAt ? "undo_check_in" : "check_in" });
    setSavingId(null);
    if (!ok) setMessage({ text: json.error || "Couldn't update.", ok: false });
    else setMessage({ text: p.checkedInAt ? `${p.fullName}: check-in undone.` : `${p.fullName} is checked in.`, ok: true });
    load();
  }

  async function saveCapacity() {
    const n = capacityInput.trim() === "" ? null : Number(capacityInput);
    const { ok, json } = await post("/api/admin/attendance", { capacity: n }, "PUT");
    if (!ok) return setMessage({ text: json.error || "Couldn't save.", ok: false });
    setEditingCapacity(false);
    setMessage({ text: n === null ? "Seat limit removed." : `Seat limit set to ${n}.`, ok: true });
    load();
  }

  async function askBulk(audience: "NOT_INVITED" | "INVITED_NOT_RESERVED") {
    setMessage(null);
    const { ok, json } = await post("/api/admin/attendance/invite", { audience, dryRun: true });
    if (!ok) return setMessage({ text: json.error || "Couldn't check.", ok: false });
    if (json.count === 0) return setMessage({ text: audience === "NOT_INVITED" ? "Everyone has already been invited." : "Nobody is waiting for a reminder.", ok: true });
    setBulk({ audience, count: json.count });
  }

  async function sendBulk() {
    if (!bulk) return;
    setSending(true);
    const { ok, json } = await post("/api/admin/attendance/invite", { audience: bulk.audience });
    setSending(false);
    setBulk(null);
    if (!ok) return setMessage({ text: json.error || "Couldn't send.", ok: false });
    setMessage({
      text: `Sent ${json.sent}${json.failed ? `, ${json.failed} failed${json.failures?.[0] ? ` (e.g. ${json.failures[0].email}: ${json.failures[0].error})` : ""}` : ""}.`,
      ok: json.failed === 0,
    });
    load();
  }

  const d = data;
  const scanned = d?.scanned;

  return (
    <AdminShell>
      <PageHeader title="Attendance" subtitle={`Invite ${lpeople}, see who has reserved a seat, and check people in at the entrance.`} />

      {message && (
        <p role="status" className={`text-sm mb-5 rounded-lg border px-4 py-2.5 ${message.ok ? "border-gold/50 bg-gold/10" : "border-red-400/50 text-red-400"}`}>
          {message.text}
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="border border-border rounded-xl px-5 py-4 bg-cardbg">
          <p className="text-xs uppercase tracking-wider text-muted mb-2">Seat limit</p>
          {editingCapacity ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                inputMode="numeric"
                value={capacityInput}
                onChange={(e) => setCapacityInput(e.target.value.replace(/[^\d]/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && saveCapacity()}
                placeholder="No limit"
                className={`${inputClass} py-1.5 w-24`}
                aria-label="Number of seats"
              />
              <button onClick={saveCapacity} className="text-sm text-goldlight font-medium">
                Save
              </button>
              <button onClick={() => setEditingCapacity(false)} className="text-sm text-muted">
                Cancel
              </button>
            </div>
          ) : (
            <>
              <p className="font-serif text-3xl leading-none">{d ? (d.capacity ?? "None") : "-"}</p>
              <button
                onClick={() => {
                  setCapacityInput(d?.capacity ? String(d.capacity) : "");
                  setEditingCapacity(true);
                }}
                className="text-xs text-goldlight mt-2 hover:underline"
              >
                Change
              </button>
            </>
          )}
        </div>
        <StatCard label="Seats reserved" value={d?.reserved ?? "-"} hint={d?.seatsLeft != null ? `${d.seatsLeft} left` : "No limit"} tone="text-goldlight" />
        <StatCard label="Invited" value={d?.invited ?? "-"} hint={d ? `${Math.max(0, d.invited - d.reserved)} haven't reserved` : undefined} />
        <StatCard label="Checked in" value={d?.checkedIn ?? "-"} hint={d ? `${Math.max(0, d.reserved - d.checkedIn)} still to arrive` : undefined} tone="text-emerald-400" />
      </div>

      <section className="border border-border rounded-xl p-5 mb-6 bg-cardbg">
        <h3 className="font-serif text-xl mb-1">Invitations</h3>
        <p className="text-sm text-muted mb-4">
          Every guest has their own link. When they open it they see their details and press <em>Reserve My Seat</em>, and their ticket is emailed to them. You can also send to a single guest from their
          page in <Link href={ep("/contacts")} className="text-goldlight underline">{people}</Link>.
        </p>
        {bulk ? (
          <div className="border border-gold/40 rounded-xl p-4">
            <p className="text-sm mb-3">
              Send {bulk.audience === "NOT_INVITED" ? "the invitation" : "a reminder"} to <strong>{bulk.count}</strong> guest{bulk.count === 1 ? "" : "s"} now?
            </p>
            <div className="flex gap-3 flex-wrap">
              <button onClick={() => setPreviewing(bulk.audience === "NOT_INVITED" ? "invitation" : "reminder")} className={ghostButton} disabled={sending}>
                Preview the email
              </button>
              <button onClick={() => setBulk(null)} className={ghostButton} disabled={sending}>
                Cancel
              </button>
              <button onClick={sendBulk} className={primaryButton} disabled={sending}>
                {sending ? "Sending… keep this page open" : `Send to ${bulk.count}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <button onClick={() => askBulk("NOT_INVITED")} className={primaryButton}>
              Invite everyone not yet invited
            </button>
            <button onClick={() => askBulk("INVITED_NOT_RESERVED")} className={ghostButton}>
              Remind those who haven&apos;t reserved
            </button>
            <button onClick={() => setPreviewing("invitation")} className={ghostButton}>
              Preview and test the emails
            </button>
          </div>
        )}
      </section>

      <section className="border border-border rounded-xl p-5 mb-6 bg-cardbg">
        <h3 className="font-serif text-xl mb-1">Find a ticket</h3>
        <p className="text-sm text-muted mb-3">Type the code on the guest&apos;s ticket (it looks like IH-7K3F9Q), or scan their QR code with a phone camera.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setLookup(code.trim().toUpperCase());
          }}
          className="flex gap-3 flex-wrap"
        >
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="IH-XXXXXX" className={`${inputClass} max-w-xs font-mono uppercase`} aria-label="Ticket code" />
          <button className={ghostButton} type="submit">
            Find
          </button>
          {lookup && (
            <button
              type="button"
              className="text-sm text-muted underline"
              onClick={() => {
                setLookup("");
                setCode("");
              }}
            >
              Clear
            </button>
          )}
        </form>
        {lookup && d?.scanNotFound && <p className="text-sm text-red-400 mt-3">No valid ticket has the code {lookup}. It may have been cancelled.</p>}
        {scanned && (
          <div className={`mt-4 rounded-xl border-2 p-4 flex flex-wrap items-center justify-between gap-4 ${scanned.checkedInAt ? "border-amber-300" : "border-gold"}`}>
            <div className="min-w-0">
              <p className="font-serif text-xl">{scanned.fullName}</p>
              <p className="text-sm text-muted">
                {scanned.email}
              </p>
              <p className="text-sm mt-1">{scanned.checkedInAt ? <span className="text-amber-300">Already checked in at {formatDateTime(scanned.checkedInAt)}</span> : <span className="text-emerald-400">Valid ticket, not yet checked in</span>}</p>
            </div>
            <button onClick={() => toggleCheckIn(scanned)} disabled={savingId === scanned.id} className={scanned.checkedInAt ? ghostButton : primaryButton}>
              {scanned.checkedInAt ? "Undo check-in" : "Check in"}
            </button>
          </div>
        )}
      </section>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reserved guests by name, email, phone or ticket code" className={`${inputClass} sm:max-w-md`} aria-label="Search reserved guests" />
        <div className="flex gap-2 flex-wrap">
          {(
            [
              ["ALL", "All"],
              ["NOT_IN", "Not in yet"],
              ["IN", "Checked in"],
            ] as const
          ).map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)} className={`text-sm px-4 py-2 rounded-full border transition-colors ${filter === v ? "border-gold bg-gold/15 font-medium" : "border-border text-muted hover:text-fg"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-border rounded-xl overflow-hidden bg-cardbg">
        <div className="table-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                {["Name", "Email", "Ticket", "Reserved", "Status", ""].map((h) => (
                  <th key={h} className="px-5 py-3 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!d && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {d && visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted">
                    {d.people.length === 0 ? "Nobody has reserved a seat yet." : "Nobody matches that."}
                  </td>
                </tr>
              )}
              {visible.map((p) => (
                <tr key={p.id} className="border-b border-border/50 last:border-b-0 hover:bg-gold/10">
                  <td className="px-5 py-3.5 whitespace-nowrap font-medium">
                    <Link href={ep(`/contacts/${p.id}`)} className="text-left hover:underline">
                      {p.fullName}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-muted whitespace-nowrap">{p.email}</td>
                  <td className="px-5 py-3.5 font-mono text-xs whitespace-nowrap">{p.ticketCode}</td>
                  <td className="px-5 py-3.5 text-muted whitespace-nowrap">{formatDateTime(p.reservedAt)}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap">{p.checkedInAt ? <Pill tone="text-emerald-400">Checked in</Pill> : <Pill>Not in yet</Pill>}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-right">
                    <button onClick={() => toggleCheckIn(p)} disabled={savingId === p.id} className={p.checkedInAt ? "text-sm text-muted hover:underline" : "text-sm text-goldlight font-semibold hover:underline"}>
                      {savingId === p.id ? "Saving…" : p.checkedInAt ? "Undo" : "Check in"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

          {previewing && <InvitationPreviewDialog initial={previewing} onClose={() => setPreviewing(null)} />}
    </AdminShell>
  );
}

export default function AttendancePage() {
  return (
    <Suspense fallback={null}>
      <AttendanceInner />
    </Suspense>
  );
}
