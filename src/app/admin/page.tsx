"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AdminShell from "@/components/AdminShell";
import RegistrationActionsMenu, { runRegistrationAction, type RegistrationAction } from "@/components/RegistrationActionsMenu";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { useIsOwner } from "@/lib/useIsOwner";

interface RegistrationRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  country: string;
  organization: string | null;
  regType: "EARLY_BIRD" | "LATE";
  deliveryStatus: string;
  deliveryError: string | null;
  paymentStatus: "NOT_PAID" | "PARTIAL" | "PAID";
  seatLabel: string | null;
  seatInviteSentAt: string | null;
  createdAt: string;
}

interface EmailStats {
  delivered: number;
  opened: number;
  bounced: number;
  failed: number;
  sentOnly: number;
  notSent: number;
}

const STATUS_STYLES: Record<string, string> = {
  OPENED: "text-emerald-400",
  DELIVERED: "text-emerald-400",
  SENT: "text-goldlight",
  BOUNCED: "text-red-400",
  FAILED: "text-red-400",
  COMPLAINED: "text-red-400",
  NOT_SENT: "text-muted",
};

function StatusDot({ status, title }: { status: string; title?: string | null }) {
  return (
    <span
      title={title || undefined}
      className={`inline-flex items-center gap-1.5 text-sm whitespace-nowrap ${STATUS_STYLES[status] ?? "text-muted"} ${title ? "cursor-help" : ""}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
      {status.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}
    </span>
  );
}

export default function RegistrationsPage() {
  const [rows, setRows] = useState<RegistrationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [search, setSearch] = useState("");
  const [regType, setRegType] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const isOwner = useIsOwner();
  const requestId = useRef(0);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `silent` refreshes (the auto-refresh poll) update the rows in place without
  // flashing the "Loading…" state. The counter drops stale responses so a slow
  // background refresh can never overwrite newer search/filter results.
  const load = useCallback(
    async (silent = false) => {
      const myRequest = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (regType !== "ALL") params.set("regType", regType);
        const res = await fetch(`/api/admin/registrations?${params.toString()}`);
        if (res.ok && myRequest === requestId.current) {
          const data = await res.json();
          setRows(data.registrations);
          setTotal(data.total);
          setStats(data.emailStats);
        }
      } catch {
        // Network hiccup — keep showing the last data; the next poll will retry.
      } finally {
        if (myRequest === requestId.current) setLoading(false);
      }
    },
    [search, regType]
  );

  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  useAutoRefresh(() => load(true), 10_000);

  function flash(text: string, ok: boolean) {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setActionMessage({ text, ok });
    messageTimer.current = setTimeout(() => setActionMessage(null), ok ? 4000 : 10000);
  }

  async function handleAction(id: string, action: RegistrationAction) {
    flash("Sending…", true);
    const result = await runRegistrationAction(id, action);
    flash(result.message, result.ok);
    load(true);
  }

  async function handleDelete(row: RegistrationRow) {
    if (!window.confirm(`Permanently delete the registration for ${row.fullName} (${row.email})? This cannot be undone.`)) {
      return;
    }
    const res = await fetch(`/api/admin/registrations/${row.id}`, { method: "DELETE" });
    if (res.ok) {
      flash("Registration deleted.", true);
      load(true);
    } else {
      const data = await res.json().catch(() => ({}));
      flash(data.error || "Failed to delete.", false);
    }
  }

  return (
    <AdminShell active="/admin">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h2 className="font-serif text-2xl">Registrations</h2>
          <p className="text-muted text-sm mt-1">
            {total} total
            {actionMessage && (
              <span className={`ml-3 ${actionMessage.ok ? "text-goldlight" : "text-red-400"}`}>{actionMessage.text}</span>
            )}
          </p>
        </div>
        <a
          href="/api/admin/registrations/export"
          className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest whitespace-nowrap"
        >
          Export CSV
        </a>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {["ALL", "EARLY_BIRD", "LATE"].map((rt) => (
          <button
            key={rt}
            onClick={() => setRegType(rt)}
            className={`text-sm px-4 py-2 rounded-full border transition-colors whitespace-nowrap ${
              regType === rt ? "border-gold text-goldlight bg-gold/10" : "border-border text-muted"
            }`}
          >
            {rt === "ALL" ? "All" : rt === "EARLY_BIRD" ? "Early Bird" : "Late"}
          </button>
        ))}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, email or phone"
        className="w-full max-w-md bg-cardbg border border-border rounded-lg px-4 py-2.5 text-sm mb-4 focus:outline-none focus:border-gold"
      />

      {stats && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm mb-6">
          <span className="text-muted">Emails:</span>
          <span className="flex items-center gap-1.5"><StatusDot status="DELIVERED" /> <span className="text-muted">{stats.delivered}</span></span>
          <span className="flex items-center gap-1.5"><StatusDot status="OPENED" /> <span className="text-muted">{stats.opened}</span></span>
          <span className="flex items-center gap-1.5"><StatusDot status="BOUNCED" /> <span className="text-muted">{stats.bounced}</span></span>
          <span className="flex items-center gap-1.5"><StatusDot status="FAILED" /> <span className="text-muted">{stats.failed}</span></span>
          <span className="flex items-center gap-1.5"><StatusDot status="NOT_SENT" /> <span className="text-muted">{stats.notSent}</span></span>
        </div>
      )}

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="table-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                <th className="sticky left-0 z-10 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Name</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Email</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Phone</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Country</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Type</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Seat</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Delivery</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Registered</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted">
                    No registrations found.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-b-0">
                    <td className="sticky left-0 z-10 bg-pagebg px-5 py-4 whitespace-nowrap font-medium">
                      {r.fullName}
                    </td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">{r.email}</td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">{r.phone}</td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">{r.country}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className="px-2.5 py-1 rounded-full border border-border text-xs whitespace-nowrap">
                        {r.regType === "LATE" ? "Late" : "Early Bird"}
                      </span>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {r.seatLabel ? (
                        <span className="px-2.5 py-1 rounded-full border border-gold/40 text-goldlight text-xs font-semibold whitespace-nowrap">
                          {r.seatLabel}
                        </span>
                      ) : (
                        <span className="text-muted text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <StatusDot status={r.deliveryStatus} title={r.deliveryError} />
                    </td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <RegistrationActionsMenu
                        paymentStatus={r.paymentStatus}
                        seatInviteSentAt={r.seatInviteSentAt}
                        onAction={(action) => handleAction(r.id, action)}
                        onDelete={isOwner ? () => handleDelete(r) : undefined}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
