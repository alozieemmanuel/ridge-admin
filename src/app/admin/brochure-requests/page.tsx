"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AdminShell from "@/components/AdminShell";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { useIsOwner } from "@/lib/useIsOwner";

interface BrochureRow {
  id: string;
  fullName: string;
  email: string;
  deliveryStatus: string;
  deliveryError: string | null;
  createdAt: string;
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

export default function BrochureRequestsPage() {
  const [rows, setRows] = useState<BrochureRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const isOwner = useIsOwner();
  const requestId = useRef(0);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `silent` refreshes (the auto-refresh poll) update rows in place without the
  // "Loading…" flash; stale responses are dropped.
  const load = useCallback(
    async (silent = false) => {
      const myRequest = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        const res = await fetch(`/api/admin/brochure-requests?${params.toString()}`);
        if (res.ok && myRequest === requestId.current) {
          const data = await res.json();
          setRows(data.requests);
          setTotal(data.total);
        }
      } catch {
        // Network hiccup — keep showing the last data; the next poll will retry.
      } finally {
        if (myRequest === requestId.current) setLoading(false);
      }
    },
    [search]
  );

  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  useAutoRefresh(() => load(true), 10_000);

  function flash(text: string, ok: boolean) {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage({ text, ok });
    messageTimer.current = setTimeout(() => setMessage(null), ok ? 4000 : 10000);
  }

  async function handleResend(id: string) {
    setSendingId(id);
    setMessage(null);
    const res = await fetch(`/api/admin/brochure-requests/${id}/resend`, { method: "POST" });
    setSendingId(null);
    if (res.ok) {
      flash("Sent.", true);
    } else {
      const data = await res.json().catch(() => ({}));
      flash(data.error || "Failed to send.", false);
    }
    load(true);
  }

  async function handleDelete(row: BrochureRow) {
    if (!window.confirm(`Permanently delete the brochure request from ${row.fullName} (${row.email})? This cannot be undone.`)) {
      return;
    }
    const res = await fetch(`/api/admin/brochure-requests/${row.id}`, { method: "DELETE" });
    if (res.ok) {
      flash("Brochure request deleted.", true);
    } else {
      const data = await res.json().catch(() => ({}));
      flash(data.error || "Failed to delete.", false);
    }
    load(true);
  }

  return (
    <AdminShell active="/admin/brochure-requests">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">Brochure Requests</h2>
        <p className="text-muted text-sm mt-1">
          {total} total
          {message && (
            <span className={`ml-3 ${message.ok ? "text-goldlight" : "text-red-400"}`}>{message.text}</span>
          )}
        </p>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name or email"
        className="w-full max-w-md bg-cardbg border border-border rounded-lg px-4 py-2.5 text-sm mb-6 focus:outline-none focus:border-gold"
      />

      <div className="border border-border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
              <th className="px-5 py-3 font-medium whitespace-nowrap">Name</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Email</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Delivery</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Requested</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-muted">
                  No brochure requests found.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="border-b border-border/50 last:border-b-0">
                  <td className="px-5 py-4 whitespace-nowrap">{r.fullName}</td>
                  <td className="px-5 py-4 text-muted whitespace-nowrap">{r.email}</td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <StatusDot status={r.deliveryStatus} title={r.deliveryError} />
                  </td>
                  <td className="px-5 py-4 text-muted whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleResend(r.id)}
                        disabled={sendingId === r.id}
                        className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-gold text-muted hover:text-fg disabled:opacity-60 whitespace-nowrap"
                      >
                        {sendingId === r.id ? "Sending…" : "Resend email"}
                      </button>
                      {isOwner && (
                        <button
                          onClick={() => handleDelete(r)}
                          className="text-xs px-3 py-1.5 rounded-full border border-red-400/40 text-red-400 hover:bg-red-500/10 whitespace-nowrap"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
