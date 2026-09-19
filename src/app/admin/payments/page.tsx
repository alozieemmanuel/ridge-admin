"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AdminShell from "@/components/AdminShell";
import RegistrationActionsMenu, { runRegistrationAction, type RegistrationAction } from "@/components/RegistrationActionsMenu";
import { useAutoRefresh } from "@/lib/useAutoRefresh";

type PaymentStatus = "NOT_PAID" | "PARTIAL" | "PAID";

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
}

interface PaymentStats {
  notPaid: number;
  partial: number;
  paid: number;
  totalCollected: number;
}

const PAYMENT_META: Record<PaymentStatus, { label: string; className: string }> = {
  NOT_PAID: { label: "Not paid", className: "border-red-400/40 text-red-300" },
  PARTIAL: { label: "Partial", className: "border-amber-400/40 text-amber-300" },
  PAID: { label: "Paid", className: "border-emerald-400/40 text-emerald-300" },
};

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function deriveStatus(amount: number, expectedFee: number | null): PaymentStatus {
  if (amount <= 0) return "NOT_PAID";
  if (expectedFee !== null && amount >= expectedFee) return "PAID";
  return "PARTIAL";
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="border border-border rounded-xl px-5 py-4 flex-1 min-w-[140px]">
      <p className="text-xs uppercase tracking-wider text-muted mb-1.5">{label}</p>
      <p className={`text-2xl font-serif ${accent}`}>{value}</p>
    </div>
  );
}

function PaymentConfirmModal({
  row,
  currency,
  expectedFee,
  onClose,
  onConfirm,
}: {
  row: RegistrationRow;
  currency: string;
  expectedFee: number | null;
  onClose: () => void;
  onConfirm: (amountPaid: number, note: string) => Promise<void>;
}) {
  const [step, setStep] = useState<"input" | "confirm">("input");
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const amount = parseFloat(amountText);
  const validAmount = amountText.trim() !== "" && !Number.isNaN(amount) && amount >= 0;
  const previewStatus = validAmount ? deriveStatus(amount, expectedFee) : null;

  function handleContinue() {
    if (!validAmount) {
      setError("Enter a valid amount (0 or more).");
      return;
    }
    setError(null);
    setStep("confirm");
  }

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(amount, note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update payment.");
      setSubmitting(false);
      return;
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md bg-cardbg border border-border rounded-2xl p-6">
        <p className="text-xs uppercase tracking-wider text-muted mb-1">Update payment</p>
        <h3 className="font-serif text-xl mb-5">{row.fullName}</h3>

        {step === "input" && (
          <>
            <label className="block text-xs uppercase tracking-wider text-muted mb-2">
              Amount received ({currency})
            </label>
            <input
              autoFocus
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder={row.amountPaid ? String(row.amountPaid) : "0"}
              className="w-full bg-black/30 border border-border rounded-lg px-4 py-2.5 text-sm mb-1 focus:outline-none focus:border-gold"
            />
            <p className="text-xs text-muted mb-4">
              Currently on file: {formatMoney(row.amountPaid, currency)}. Enter the new total amount received to
              date for this registration
              {expectedFee !== null ? ` — expected fee is ${formatMoney(expectedFee, currency)}.` : "."}
            </p>

            <label className="block text-xs uppercase tracking-wider text-muted mb-2">
              Note <span className="normal-case text-muted/70">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. bank transfer ref, part of a split payment…"
              className="w-full bg-black/30 border border-border rounded-lg px-4 py-2.5 text-sm mb-1 focus:outline-none focus:border-gold resize-none"
            />

            {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={onClose}
                className="text-sm px-4 py-2.5 rounded-full border border-border text-muted hover:text-fg"
              >
                Cancel
              </button>
              <button
                onClick={handleContinue}
                className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest"
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === "confirm" && previewStatus && (
          <>
            <div className="border border-border rounded-xl p-4 mb-5 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted">Amount received</span>
                <span>{formatMoney(amount, currency)}</span>
              </div>
              {expectedFee !== null && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Expected fee</span>
                  <span>{formatMoney(expectedFee, currency)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm items-center pt-2 border-t border-border/50">
                <span className="text-muted">New status</span>
                <span className={`text-xs rounded-full border px-2.5 py-1 ${PAYMENT_META[previewStatus].className}`}>
                  {PAYMENT_META[previewStatus].label}
                </span>
              </div>
            </div>
            <p className="text-sm text-muted mb-5">
              This will mark <span className="text-fg">{row.fullName}</span> as{" "}
              <span className="text-fg">{PAYMENT_META[previewStatus].label.toLowerCase()}</span> and record today's
              date as the payment update date. Continue?
            </p>

            {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setStep("input")}
                disabled={submitting}
                className="text-sm px-4 py-2.5 rounded-full border border-border text-muted hover:text-fg disabled:opacity-60"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitting}
                className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest disabled:opacity-60"
              >
                {submitting ? "Confirming…" : "Confirm"}
              </button>
            </div>
          </>
        )}
      </div>
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

  async function handleEmailAction(id: string, action: RegistrationAction) {
    flash("Sending…", true);
    const result = await runRegistrationAction(id, action);
    flash(result.message, result.ok);
    load(true);
  }

  const visibleRows = statusFilter === "ALL" ? rows : rows.filter((r) => r.paymentStatus === statusFilter);

  function expectedFeeFor(row: RegistrationRow): number | null {
    return row.regType === "LATE" ? feeAmounts.late : feeAmounts.early;
  }

  async function handleConfirmPayment(id: string, amountPaid: number, note: string) {
    const res = await fetch(`/api/admin/registrations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountPaid, note }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to update payment.");
    }
    setActiveRow(null);
    flash("Payment updated.", true);
    load(true);
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
                  return (
                    <tr key={r.id} className="border-b border-border/50 last:border-b-0">
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
                            Update payment
                          </button>
                          <RegistrationActionsMenu
                            paymentStatus={r.paymentStatus}
                            seatInviteSentAt={r.seatInviteSentAt}
                            onAction={(action) => handleEmailAction(r.id, action)}
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
        <PaymentConfirmModal
          row={activeRow}
          currency={currency}
          expectedFee={expectedFeeFor(activeRow)}
          onClose={() => setActiveRow(null)}
          onConfirm={(amountPaid, note) => handleConfirmPayment(activeRow.id, amountPaid, note)}
        />
      )}
    </AdminShell>
  );
}
