"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { useAutoRefresh } from "@/lib/useAutoRefresh";

interface LogRow {
  id: string;
  adminId: string | null;
  adminName: string;
  adminEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in attempt",
  "auth.logout": "Signed out",
  "registration.payment_update": "Updated payment",
  "registration.payment_reset": "Reset payment",
  "registration.resend_confirmation": "Confirmation email",
  "registration.send_seat_invite": "Seat-selection email",
  "registration.send_payment_reminder": "Payment reminder",
  "registration.checkin": "Attendance",
  "registration.delete": "Deleted registration",
  "registration.export": "Exported registrations",
  "payment_proof.reject": "Rejected receipt",
  "brochure.delete": "Deleted brochure request",
  "campaign.send": "Sent campaign",
  "seat.update": "Changed seat",
  "template.update": "Edited email template",
  "settings.update": "Changed settings",
  "admin.create": "Added admin",
  "admin.delete": "Removed admin",
  "data.clear": "Cleared data",
};

const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "All activity" },
  { value: "auth", label: "Sign-ins" },
  { value: "registration", label: "Registrations & payments" },
  { value: "payment_proof", label: "Receipts" },
  { value: "brochure", label: "Brochure requests" },
  { value: "campaign", label: "Campaigns" },
  { value: "seat", label: "Seats" },
  { value: "template", label: "Templates" },
  { value: "settings", label: "Settings" },
  { value: "admin", label: "Admins" },
  { value: "data", label: "Data clearing" },
];

/** One readable sentence about what changed, built from the stored details. */
function summarize(row: LogRow): string {
  const d = (row.details ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (row.action) {
    case "registration.payment_update":
      return `${d.approvedReceipts ? `Approved ${d.approvedReceipts} receipt(s) · ` : ""}${d.confirmationEmail ? `confirmation email ${d.confirmationEmail} · ` : ""}${d.before?.amountPaid ?? 0} → ${d.after?.amountPaid ?? 0} (${String(d.before?.status ?? "").replace("_", " ").toLowerCase()} → ${String(d.after?.status ?? "").replace("_", " ").toLowerCase()})${d.note ? ` · “${d.note}”` : ""}`;
    case "registration.payment_reset":
      return `Cleared ${d.before?.amountPaid ?? 0} (was ${String(d.before?.status ?? "").replace("_", " ").toLowerCase()})`;
    case "registration.resend_confirmation":
    case "registration.send_seat_invite":
    case "registration.send_payment_reminder": {
      const outcome = d.outcome as string | undefined;
      if (outcome === "blocked") return `Blocked — ${d.reason ?? "not allowed"}`;
      if (outcome === "failed") return `Failed — ${d.error ?? "unknown error"}`;
      return `Sent to ${d.to ?? "participant"}`;
    }
    case "registration.checkin":
      return d.checkedIn ? "Marked as arrived" : "Check-in undone";
    case "registration.delete":
      return `${d.email ?? ""}${d.amountPaid ? ` · had paid ${d.amountPaid}` : ""}`;
    case "campaign.send":
      return `${d.audience ?? ""}: ${d.sentCount ?? 0} sent, ${d.failedCount ?? 0} failed of ${d.recipientCount ?? 0}`;
    case "seat.update":
      return `${d.from ?? ""} → ${d.to ?? ""}`;
    case "settings.update":
      return `Changed: ${Array.isArray(d.changedKeys) ? d.changedKeys.join(", ") : ""}`;
    case "admin.create":
    case "admin.delete":
      return `${d.email ?? ""} (${String(d.role ?? "").toLowerCase()})`;
    case "data.clear":
      return `${d.registrations ?? 0} registrations, ${d.brochureRequests ?? 0} brochure requests`;
    case "auth.login_failed":
      return String(d.reason ?? "");
    default:
      return "";
  }
}

const OUTCOME_STYLE = (row: LogRow): string => {
  const outcome = (row.details as { outcome?: string } | null)?.outcome;
  if (row.action === "auth.login_failed" || outcome === "failed" || row.action === "data.clear") return "text-red-400";
  if (outcome === "blocked") return "text-amber-300";
  return "text-fg";
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [admins, setAdmins] = useState<{ id: string; name: string }[]>([]);
  const [adminFilter, setAdminFilter] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      const mine = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "50" });
        if (adminFilter) params.set("admin", adminFilter);
        if (category) params.set("category", category);
        if (search) params.set("search", search);
        const res = await fetch(`/api/admin/audit-logs?${params.toString()}`);
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        if (res.ok && mine === requestId.current) {
          const data = await res.json();
          setLogs(data.logs);
          setTotal(data.total);
          setAdmins(data.admins);
        }
      } catch {
        // keep the last data; the next poll retries
      } finally {
        if (mine === requestId.current) setLoading(false);
      }
    },
    [adminFilter, category, search, page]
  );

  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  useAutoRefresh(() => load(true), 15_000);

  // Any filter change goes back to the first page.
  useEffect(() => {
    setPage(1);
  }, [adminFilter, category, search]);

  const pages = Math.max(1, Math.ceil(total / 50));
  const selectClass =
    "bg-cardbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold";

  return (
    <AdminShell active="/admin/audit">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">Audit Log</h2>
        <p className="text-muted text-sm mt-1">
          {total} entr{total === 1 ? "y" : "ies"} · a permanent record of what each admin did. Entries can&apos;t be
          edited or deleted.
        </p>
      </div>

      {forbidden && <p className="text-muted text-sm">Only an owner can view the audit log.</p>}

      {!forbidden && (
        <>
          <div className="flex gap-3 mb-6 flex-wrap">
            <select value={adminFilter} onChange={(e) => setAdminFilter(e.target.value)} className={selectClass}>
              <option value="">All admins</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectClass}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search admin or person"
              className={`${selectClass} w-full max-w-xs`}
            />
          </div>

          <div className="border border-border rounded-xl overflow-hidden">
            <div className="table-scroll overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                    <th className="px-5 py-3 font-medium whitespace-nowrap">When</th>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">Admin</th>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">Action</th>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">Who / what</th>
                    <th className="px-5 py-3 font-medium">Details</th>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-muted">
                        Loading…
                      </td>
                    </tr>
                  )}
                  {!loading && logs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-muted">
                        Nothing recorded yet.
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    logs.map((row) => (
                      <tr key={row.id} className="border-b border-border/50 last:border-b-0 align-top">
                        <td className="px-5 py-4 text-muted whitespace-nowrap">
                          {new Date(row.createdAt).toLocaleString()}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          {row.adminName}
                          {row.adminEmail && <span className="block text-xs text-muted">{row.adminEmail}</span>}
                        </td>
                        <td className={`px-5 py-4 whitespace-nowrap ${OUTCOME_STYLE(row)}`}>
                          {ACTION_LABELS[row.action] ?? row.action}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">{row.entityLabel ?? "—"}</td>
                        <td className="px-5 py-4 text-muted">{summarize(row)}</td>
                        <td className="px-5 py-4 text-muted whitespace-nowrap">{row.ipAddress ?? "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded-full border border-border text-muted hover:text-fg disabled:opacity-50"
              >
                Newer
              </button>
              <span className="text-muted">
                Page {page} of {pages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page === pages}
                className="px-4 py-2 rounded-full border border-border text-muted hover:text-fg disabled:opacity-50"
              >
                Older
              </button>
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}