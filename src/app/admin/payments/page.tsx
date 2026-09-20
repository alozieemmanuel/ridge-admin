"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AdminShell from "@/components/AdminShell";
import RegistrationActionsMenu, { runRegistrationAction, type RegistrationAction } from "@/components/RegistrationActionsMenu";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { useIsOwner } from "@/lib/useIsOwner";
import ProofList, { suggestedTotal, type ProofInfo } from "@/components/ProofList";
import { PaymentUpdateModal, PAYMENT_META, formatMoney, type PaymentStatus } from "@/components/PaymentUpdateModal";

interface RegistrationRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  regType: "EARLY_BIRD" | "LATE";
  paymentStatus: PaymentStatus;
  paymentNote: string | null;
  amountPaid: number;
  paymentUpdatedAt: string | null;
  seatInviteSentAt: string | null;
  proofs: ProofInfo[];
}

interface PaymentStats {
  notPaid: number;
  partial: number;
  paid: number;
  totalCollected: number;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="border border-border rounded-xl px-5 py-4 flex-1 min-w-[140px]">
      <p className="text-xs uppercase tracking-wider text-muted mb-1.5">{label}</p>
      <p className={`text-2xl font-serif ${accent}`}>{value}</p>
    </div>
  );
}

export default function PaymentsPage() {
  const [rows, setRows] = useState<RegistrationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [feeAmounts, setFeeAmounts] = useState<{ early: number | null; late: number | null }>({
    early: null,
    late: null,
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [activeRow, setActiveRow] = useState<RegistrationRow | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const isOwner = useIsOwner();
  const requestId = useRef(0);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `silent` refreshes (the auto-refresh poll) update rows in place without the
  // "Loading…" flash and skip re-fetching settings; stale responses are dropped.
  const load = useCallback(
    async (silent = false) => {
      const myRequest = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        params.set("pageSize", "200");
        const [regRes, settingsRes] = await Promise.all([
          fetch(`/api/admin/registrations?${params.toString()}`),
          silent ? Promise.resolve(null) : fetch("/api/admin/settings"),
        ]);
        if (myRequest !== requestId.current) return;
        if (regRes.ok) {
          const data = await regRes.json();
          setRows(data.registrations);
          setTotal(data.total);
          setStats(data.paymentStats);
        }
        if (settingsRes && settingsRes.ok) {
          const data = await settingsRes.json();
          setCurrency(data.settings.currency || "USD");
          const early = parseFloat(data.settings.registration_fee_amount);
          const late = parseFloat(data.settings.late_registration_fee_amount);
          setFeeAmounts({
            early: Number.isFinite(early) ? early : null,
            late: Number.isFinite(late) ? late : null,
          });
        }
      } catch {
        // Network hiccup: keep showing the last data; the next poll will retry.
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

  async function handleEmailAction(id: string, action: RegistrationAction) {
    flash("Sending…", true);
    const result = await runRegistrationAction(id, action);
    flash(result.message, result.ok);
    load(true);
  }

  async function handleReset(row: RegistrationRow) {
    const extra = row.seatInviteSentAt
      ? " A seat invite was already sent to them; their seat (if any) is not changed."
      : "";
    if (
      !window.confirm(
        `Reset ${row.fullName}'s payment? This clears the recorded amount (${formatMoney(row.amountPaid, currency)}), note and date and marks them as not paid.${extra}`
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/registrations/${row.id}/payment`, { method: "DELETE" });
    if (res.ok) {
      flash("Payment reset.", true);
      load(true);
    } else {
      const data = await res.json().catch(() => ({}));
      flash(data.error || "Failed to reset payment.", false);
    }
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

  const visibleRows = statusFilter === "ALL" ? rows : rows.filter((r) => r.paymentStatus === statusFilter);

  function expectedFeeFor(row: RegistrationRow): number | null {
    return row.regType === "LATE" ? feeAmounts.late : feeAmounts.early;
  }

  async function handleConfirmPayment(
    id: string,
    amountPaid: number,
    note: string,
    opts: { sendConfirmation: boolean; approveProofIds: string[] }
  ) {
    const res = await fetch(`/api/admin/registrations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountPaid, note, ...opts }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to update payment.");
    setActiveRow(null);
    if (data.emailError) flash(`Payment updated, but the confirmation email failed: ${data.emailError}`, false);
    else flash(data.emailSent ? "Payment updated and confirmation emailed." : "Payment updated.", true);
    load(true);
  }

  async function handleRejectProof(proof: ProofInfo) {
    if (!window.confirm("Reject this receipt? The participant is not emailed.")) return;
    const res = await fetch(`/api/admin/payment-proofs/${proof.id}`, { method: "PATCH" });
    if (res.ok) {
      flash("Receipt rejected.", true);
      load(true);
    } else {
      const data = await res.json().catch(() => ({}));
      flash(data.error || "Failed to reject receipt.", false);
    }
  }

  return (
    <AdminShell active="/admin/payments">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">Payments</h2>
        <p className="text-muted text-sm mt-1">
          {total} registrations
          {message && (
            <span className={`ml-3 ${message.ok ? "text-goldlight" : "text-red-400"}`}>{message.text}</span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        <StatCard label="Not paid" value={String(stats?.notPaid ?? 0)} accent="text-red-300" />
        <StatCard label="Partial" value={String(stats?.partial ?? 0)} accent="text-amber-300" />
        <StatCard label="Paid" value={String(stats?.paid ?? 0)} accent="text-emerald-300" />
        <StatCard
          label="Total collected"
          value={formatMoney(stats?.totalCollected ?? 0, currency)}
          accent="text-goldlight"
        />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {(["ALL", "NOT_PAID", "PARTIAL", "PAID"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-sm px-4 py-2 rounded-full border transition-colors whitespace-nowrap ${
              statusFilter === s ? "border-gold text-goldlight bg-gold/10" : "border-border text-muted"
            }`}
          >
            {s === "ALL" ? "All" : PAYMENT_META[s].label}
          </button>
        ))}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, email or phone"
        className="w-full max-w-md bg-cardbg border border-border rounded-lg px-4 py-2.5 text-sm mb-6 focus:outline-none focus:border-gold"
      />

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="table-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                <th className="sticky left-0 z-10 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Name</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Email</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Phone</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Type</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Payment</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Updated</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-muted">
                    No registrations found.
                  </td>
                </tr>
              )}
              {!loading &&
                visibleRows.map((r) => {
                  const fee = expectedFeeFor(r);
                  const meta = PAYMENT_META[r.paymentStatus];
                  const pendingCount = r.proofs.filter((p) => p.status === "PENDING").length;
                  return (
                    <tr key={r.id} className="border-b border-border/50 last:border-b-0 align-top">
                      <td className="sticky left-0 z-10 bg-pagebg px-5 py-4 whitespace-nowrap font-medium">
                        {r.fullName}
                      </td>
                      <td className="px-5 py-4 text-muted whitespace-nowrap">{r.email}</td>
                      <td className="px-5 py-4 text-muted whitespace-nowrap">{r.phone}</td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className="px-2.5 py-1 rounded-full border border-border text-xs whitespace-nowrap">
                          {r.regType === "LATE" ? "Late" : "Early Bird"}
                        </span>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span
                          title={r.paymentNote || undefined}
                          className={`inline-flex flex-col leading-tight text-xs rounded-full border px-2.5 py-1 ${meta.className}`}
                        >
                          {meta.label}
                        </span>
                        <span className="block text-xs text-muted mt-1">
                          {formatMoney(r.amountPaid, currency)}
                          {fee !== null ? ` of ${formatMoney(fee, currency)}` : ""}
                        </span>
                        <ProofList proofs={r.proofs} onReject={handleRejectProof} />
                      </td>
                      <td className="px-5 py-4 text-muted whitespace-nowrap">
                        {r.paymentUpdatedAt ? new Date(r.paymentUpdatedAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setActiveRow(r)}
                            className="text-xs px-3.5 py-2 rounded-full border border-gold/40 text-goldlight hover:bg-gold/10 whitespace-nowrap"
                          >
                            {pendingCount > 0 ? `Approve payment (${pendingCount})` : "Update payment"}
                          </button>
                          {/* The most useful next email for this person: chase the balance,
                              or once they've paid in full, invite them to pick a seat. */}
                          {r.paymentStatus === "PAID" ? (
                            <button
                              onClick={() => handleEmailAction(r.id, "send_seat_invite")}
                              className="text-xs px-3.5 py-2 rounded-full border border-border text-fg hover:border-gold whitespace-nowrap"
                            >
                              {r.seatInviteSentAt ? "Resend seat invite" : "Send seat invite"}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleEmailAction(r.id, "send_payment_reminder")}
                              className="text-xs px-3.5 py-2 rounded-full border border-border text-fg hover:border-gold whitespace-nowrap"
                            >
                              Send payment reminder
                            </button>
                          )}
                          <RegistrationActionsMenu
                            paymentStatus={r.paymentStatus}
                            seatInviteSentAt={r.seatInviteSentAt}
                            onAction={(action) => handleEmailAction(r.id, action)}
                            onUpdatePayment={() => setActiveRow(r)}
                            onResetPayment={() => handleReset(r)}
                            onDelete={isOwner ? () => handleDelete(r) : undefined}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {activeRow && (
        <PaymentUpdateModal
          row={activeRow}
          currency={currency}
          expectedFee={expectedFeeFor(activeRow)}
          pendingProofs={activeRow.proofs.filter((p) => p.status === "PENDING")}
          initialAmount={suggestedTotal(activeRow.amountPaid, activeRow.proofs)}
          onClose={() => setActiveRow(null)}
          onConfirm={(amountPaid, note, opts) => handleConfirmPayment(activeRow.id, amountPaid, note, opts)}
        />
      )}
    </AdminShell>
  );
}