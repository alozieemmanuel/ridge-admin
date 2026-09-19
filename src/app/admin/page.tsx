"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AdminShell from "@/components/AdminShell";

interface RegistrationRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  country: string;
  organization: string | null;
  regType: "EARLY_BIRD" | "LATE";
  deliveryStatus: string;
  seatLabel: string | null;
  paymentStatus: "NOT_PAID" | "PARTIAL" | "PAID";
  paymentNote: string | null;
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

interface PaymentStats {
  notPaid: number;
  partial: number;
  paid: number;
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

const PAYMENT_META: Record<string, { label: string; className: string }> = {
  NOT_PAID: { label: "Not paid", className: "border-red-400/40 text-red-300" },
  PARTIAL: { label: "Partial", className: "border-amber-400/40 text-amber-300" },
  PAID: { label: "Paid", className: "border-emerald-400/40 text-emerald-300" },
};

function StatusDot({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm whitespace-nowrap ${STATUS_STYLES[status] ?? "text-muted"}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
      {status.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}
    </span>
  );
}

function PaymentBadge({
  status,
  note,
  onChange,
}: {
  status: RegistrationRow["paymentStatus"];
  note: string | null;
  onChange: (status: RegistrationRow["paymentStatus"]) => void;
}) {
  const meta = PAYMENT_META[status];
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value as RegistrationRow["paymentStatus"])}
      title={note || undefined}
      className={`text-xs rounded-full border px-2.5 py-1 bg-transparent cursor-pointer whitespace-nowrap ${meta.className}`}
    >
      <option value="NOT_PAID" className="bg-cardbg text-fg">Not paid</option>
      <option value="PARTIAL" className="bg-cardbg text-fg">Partial</option>
      <option value="PAID" className="bg-cardbg text-fg">Paid</option>
    </select>
  );
}

function RowActionsMenu({
  row,
  onAction,
}: {
  row: RegistrationRow;
  onAction: (action: "resend_confirmation" | "send_seat_invite" | "send_payment_reminder") => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-full border border-border text-muted hover:text-fg hover:border-gold flex items-center justify-center"
        aria-label="Row actions"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-cardbg border border-border rounded-xl shadow-xl z-10 overflow-hidden">
          <button
            onClick={() => {
              onAction("resend_confirmation");
              setOpen(false);
            }}
            className="w-full text-left px-4 py-3 text-sm hover:bg-gold/10 border-b border-border/50"
          >
            Resend confirmation email
          </button>
          <button
            onClick={() => {
              onAction("send_seat_invite");
              setOpen(false);
            }}
            className="w-full text-left px-4 py-3 text-sm hover:bg-gold/10 border-b border-border/50"
          >
            {row.seatInviteSentAt ? "Resend seat-selection invite" : "Send seat-selection invite"}
          </button>
          <button
            onClick={() => {
              onAction("send_payment_reminder");
              setOpen(false);
            }}
            className="w-full text-left px-4 py-3 text-sm hover:bg-gold/10"
          >
            Send payment reminder
          </button>
        </div>
      )}
    </div>
  );
}

export default function RegistrationsPage() {
  const [rows, setRows] = useState<RegistrationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [paymentStats, setPaymentStats] = useState<PaymentStats | null>(null);
  const [search, setSearch] = useState("");
  const [regType, setRegType] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (regType !== "ALL") params.set("regType", regType);
    const res = await fetch(`/api/admin/registrations?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setRows(data.registrations);
      setTotal(data.total);
      setStats(data.emailStats);
      setPaymentStats(data.paymentStats);
    }
    setLoading(false);
  }, [search, regType]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function handlePaymentChange(id: string, paymentStatus: RegistrationRow["paymentStatus"]) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, paymentStatus } : r)));
    const res = await fetch(`/api/admin/registrations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentStatus }),
    });
    if (!res.ok) load();
    else load(); // refresh payment stats summary too
  }

  async function handleAction(
    id: string,
    action: "resend_confirmation" | "send_seat_invite" | "send_payment_reminder"
  ) {
    setActionMessage("Sending…");
    const res = await fetch(`/api/admin/registrations/${id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      setActionMessage("Sent.");
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setActionMessage(data.error || "Failed to send.");
    }
    setTimeout(() => setActionMessage(null), 4000);
  }

  return (
    <AdminShell active="/admin">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h2 className="font-serif text-2xl">Registrations</h2>
          <p className="text-muted text-sm mt-1">
            {total} total
            {actionMessage && <span className="text-goldlight ml-3">{actionMessage}</span>}
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

      <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm mb-6">
        {stats && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-muted">Emails:</span>
            <span className="flex items-center gap-1.5"><StatusDot status="DELIVERED" /> <span className="text-muted">{stats.delivered}</span></span>
            <span className="flex items-center gap-1.5"><StatusDot status="OPENED" /> <span className="text-muted">{stats.opened}</span></span>
            <span className="flex items-center gap-1.5"><StatusDot status="BOUNCED" /> <span className="text-muted">{stats.bounced}</span></span>
            <span className="flex items-center gap-1.5"><StatusDot status="FAILED" /> <span className="text-muted">{stats.failed}</span></span>
            <span className="flex items-center gap-1.5"><StatusDot status="NOT_SENT" /> <span className="text-muted">{stats.notSent}</span></span>
          </div>
        )}
        {paymentStats && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-muted">Payments:</span>
            <span className="text-red-300">{paymentStats.notPaid} not paid</span>
            <span className="text-amber-300">{paymentStats.partial} partial</span>
            <span className="text-emerald-300">{paymentStats.paid} paid</span>
          </div>
        )}
      </div>

      <div className="border border-border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
              <th className="px-5 py-3 font-medium whitespace-nowrap">Name</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Email</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Phone</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Country</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Type</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Seat</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Payment</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Delivery</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Registered</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="px-5 py-8 text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-5 py-8 text-center text-muted">
                  No registrations found.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="border-b border-border/50 last:border-b-0">
                  <td className="px-5 py-4 whitespace-nowrap">{r.fullName}</td>
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
                    <PaymentBadge
                      status={r.paymentStatus}
                      note={r.paymentNote}
                      onChange={(status) => handlePaymentChange(r.id, status)}
                    />
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <StatusDot status={r.deliveryStatus} />
                  </td>
                  <td className="px-5 py-4 text-muted whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <RowActionsMenu row={r} onAction={(action) => handleAction(r.id, action)} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
