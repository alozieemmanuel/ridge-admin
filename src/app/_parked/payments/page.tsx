"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AdminShell from "@/components/AdminShell";
import RegistrationActionsMenu, { runRegistrationAction, type RegistrationAction } from "@/components/RegistrationActionsMenu";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { useIsOwner } from "@/lib/useIsOwner";
import ProofList, { suggestedTotal, type ProofInfo } from "@/components/ProofList";
import { PaymentUpdateModal, PAYMENT_META, formatMoney, type PaymentStatus } from "@/components/PaymentUpdateModal";
import Pagination from "@/components/Pagination";
import { cacheGet, cacheSet, fetchAndCache, getStoredPageSize, storePageSize } from "@/lib/clientCache";
import { paymentsUrl } from "@/lib/adminData";

type PayView = "PAID_PARTIAL" | "PARTIAL" | "PAID" | "AWAITING";

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
  lastReminderAt?: string | null;
  seatLabel?: string | null;
  attendanceMode?: "IN_PERSON" | "ONLINE" | null;
  proofs: ProofInfo[];
}

interface PaymentStats {
  notPaid: number;
  partial: number;
  paid: number;
  totalCollected: number;
  outstanding: number;
  awaitingApproval: number;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="border border-border rounded-xl px-5 py-4 flex-1 min-w-[140px]">
      <p className="text-xs uppercase tracking-wider text-muted mb-1.5">{label}</p>
      <p className={`text-2xl font-serif ${accent}`}>{value}</p>
    </div>
  );
}

interface PaymentsResponse {
  registrations: RegistrationRow[];
  total: number;
  paymentStats?: PaymentStats;
}

interface SettingsResponse {
  settings: Record<string, string>;
}

function readSettings(data: SettingsResponse | undefined) {
  if (!data) return null;
  const early = parseFloat(data.settings.registration_fee_amount);
  const late = parseFloat(data.settings.late_registration_fee_amount);
  return {
    currency: data.settings.currency || "USD",
    feeAmounts: {
      early: Number.isFinite(early) ? early : null,
      late: Number.isFinite(late) ? late : null,
    },
  };
}

export default function PaymentsPage() {
  const [pageSize, setPageSize] = useState(() => getStoredPageSize());
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // the search text, after the typing pause
  const [view, setView] = useState<PayView>("PAID_PARTIAL");

  // What this page showed last time is on screen straight away; fresh data replaces it a moment later.
  const firstUrl = paymentsUrl({ page: 1, pageSize, view: "PAID_PARTIAL" });
  const [initial] = useState(() => cacheGet<PaymentsResponse>(firstUrl));
  const [initialSettings] = useState(() => readSettings(cacheGet<SettingsResponse>("/api/admin/settings")));
  const [rows, setRows] = useState<RegistrationRow[]>(initial?.registrations ?? []);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [stats, setStats] = useState<PaymentStats | null>(initial?.paymentStats ?? null);
  const [currency, setCurrency] = useState(initialSettings?.currency ?? "USD");
  const [feeAmounts, setFeeAmounts] = useState<{ early: number | null; late: number | null }>(
    initialSettings?.feeAmounts ?? { early: null, late: null }
  );
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(!initial);
  const [activeRow, setActiveRow] = useState<RegistrationRow | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const isOwner = useIsOwner();
  // Per-person state of the payment reminder button: "sending" while the email goes out, "sent" briefly after.
  const [reminderState, setReminderState] = useState<Record<string, "sending" | "sent">>({});
  // The new "last reminder" time shown straight away, before the list reloads.
  const [reminderSentAt, setReminderSentAt] = useState<Record<string, string>>({});
  const requestId = useRef(0);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wait a moment after typing before searching.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  function changeView(v: PayView) {
    setView(v);
    setPage(1);
  }
  function changePageSize(n: number) {
    storePageSize(n);
    setPageSize(n);
    setPage(1);
  }

  // The currency and fees only change when Settings do, so they are fetched once and reused.
  useEffect(() => {
    let cancelled = false;
    fetchAndCache<SettingsResponse>("/api/admin/settings").then((data) => {
      const s = readSettings(data ?? undefined);
      if (s && !cancelled) {
        setCurrency(s.currency);
        setFeeAmounts(s.feeAmounts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // `silent` refreshes (the auto-refresh poll) update rows in place without the
  // "Loading…" flash; stale responses are dropped.
  const load = useCallback(
    async (silent = false) => {
      const myRequest = ++requestId.current;
      const url = paymentsUrl({ page, pageSize, search: query, view });
      const apply = (data: PaymentsResponse) => {
        setRows(data.registrations);
        setTotal(data.total);
        if (data.paymentStats) setStats(data.paymentStats);
      };
      if (!silent) {
        const cached = cacheGet<PaymentsResponse>(url);
        if (cached) {
          apply(cached);
          setLoading(false);
        } else {
          setLoading(true);
        }
      }
      try {
        const res = await fetch(url);
        if (myRequest !== requestId.current) return;
        if (res.ok) {
          const data: PaymentsResponse = await res.json();
          cacheSet(url, data);
          apply(data);
          // Removing the last row of the last page leaves an empty page: step back.
          if (data.registrations.length === 0 && page > 1 && data.total > 0) {
            setPage(Math.max(1, Math.ceil(data.total / pageSize)));
          }
        }
      } catch {
        // Network hiccup: keep showing the last data; the next poll will retry.
      } finally {
        if (myRequest === requestId.current) setLoading(false);
      }
    },
    [page, pageSize, query, view]
  );

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefresh(() => load(true), 10_000);

  function flash(text: string, ok: boolean) {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage({ text, ok });
    messageTimer.current = setTimeout(() => setMessage(null), ok ? 4000 : 10000);
  }

  async function handleEmailAction(id: string, action: RegistrationAction) {
    // The reminder and seat-invite buttons show their own progress on the button itself.
    const tracked = action === "send_payment_reminder" || action === "send_seat_invite";
    const key = `${action}:${id}`;
    // Ignore a second click while this person's email is already going out.
    if (tracked && reminderState[key]) return;

    if (tracked) setReminderState((s) => ({ ...s, [key]: "sending" }));
    else flash("Sending…", true);

    const result = await runRegistrationAction(id, action);

    if (tracked) {
      const clear = () =>
        setReminderState((s) => {
          const next = { ...s };
          delete next[key];
          return next;
        });
      if (result.ok) {
        if (action === "send_payment_reminder") setReminderSentAt((s) => ({ ...s, [id]: new Date().toISOString() }));
        setReminderState((s) => ({ ...s, [key]: "sent" }));
        setTimeout(clear, 2500);
      } else {
        clear();
        flash(result.message, false);
      }
    } else {
      flash(result.message, result.ok);
    }
    load(true);
  }

  function lastReminderLabel(row: RegistrationRow): string {
    const times = [row.lastReminderAt, reminderSentAt[row.id]].filter((t): t is string => Boolean(t));
    if (times.length === 0) return "No reminder sent yet";
    const latest = times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
    return `Last reminder: ${new Date(latest).toLocaleString([], {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}`;
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

  function expectedFeeFor(row: RegistrationRow): number | null {
    return row.regType === "LATE" ? feeAmounts.late : feeAmounts.early;
  }

  async function handleConfirmPayment(
    id: string,
    amountPaid: number,
    note: string,
    opts: { sendConfirmation: boolean; approveProofIds: string[]; payment?: { currency: string; amount: number; rate: number } }
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
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="font-serif text-2xl">Payments</h2>
          <p className="text-muted text-sm mt-1">
            {total.toLocaleString()} {view === "AWAITING" ? "waiting for approval" : "paid or part-paid"}
            {message && (
              <span className={`ml-3 ${message.ok ? "text-goldlight" : "text-red-400"}`}>{message.text}</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setPicking(true)}
          className="text-sm px-5 py-2.5 rounded-full border border-gold/40 text-goldlight hover:bg-gold/10 whitespace-nowrap"
        >
          Record a payment
        </button>
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        <StatCard label="Paid" value={String(stats?.paid ?? 0)} accent="text-emerald-300" />
        <StatCard label="Partial" value={String(stats?.partial ?? 0)} accent="text-amber-300" />
        <StatCard
          label="Total collected"
          value={formatMoney(stats?.totalCollected ?? 0, currency)}
          accent="text-goldlight"
        />
        <StatCard
          label="Outstanding"
          value={formatMoney(stats?.outstanding ?? 0, currency)}
          accent="text-red-300"
        />
      </div>
      <p className="text-xs text-muted -mt-3 mb-6">Outstanding is the balance still owed by partial payers.</p>

      <div className="flex gap-2 mb-4 flex-wrap">
        {(
          [
            { v: "PAID_PARTIAL", label: "All", count: (stats?.paid ?? 0) + (stats?.partial ?? 0) },
            { v: "PARTIAL", label: "Partial", count: stats?.partial ?? 0 },
            { v: "PAID", label: "Paid", count: stats?.paid ?? 0 },
            { v: "AWAITING", label: "Awaiting approval", count: stats?.awaitingApproval ?? 0 },
          ] as { v: PayView; label: string; count: number }[]
        ).map((t) => (
          <button
            key={t.v}
            onClick={() => changeView(t.v)}
            className={`text-sm px-4 py-2 rounded-full border transition-colors whitespace-nowrap ${
              view === t.v ? "border-gold text-goldlight bg-gold/10" : "border-border text-muted"
            }`}
          >
            {t.label}
            <span className="ml-1.5 opacity-70">{t.count}</span>
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
        <div className="table-scroll overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                <th className="sticky left-0 top-0 z-30 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Name</th>
                <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Type</th>
                <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Payment</th>
                <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Receipt</th>
                <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Updated</th>
                <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap"></th>
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
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted">
                    {view === "AWAITING" ? "Nothing is waiting for approval." : "No payments found."}
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => {
                  const fee = expectedFeeFor(r);
                  const meta = PAYMENT_META[r.paymentStatus];
                  const pendingCount = r.proofs.filter((p) => p.status === "PENDING").length;
                  return (
                    <tr key={r.id} className="border-b border-border/50 last:border-b-0 align-top">
                      <td className="sticky left-0 z-10 bg-pagebg px-5 py-4 whitespace-nowrap font-medium">
                        {r.fullName}
                      </td>
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
                      <td className="px-5 py-4 whitespace-nowrap">
                        {r.proofs.length === 0 ? (
                          <span className="text-muted text-xs">No receipt</span>
                        ) : (
                          <ProofList proofs={r.proofs} onReject={handleRejectProof} />
                        )}
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
                          {r.paymentStatus === "PAID" && (r.seatLabel || r.attendanceMode === "ONLINE") ? (
                            <span className="text-xs px-3.5 py-2 rounded-full border border-border text-muted whitespace-nowrap">
                              {r.seatLabel ? `Seat ${r.seatLabel} booked` : "Attending online"}
                            </span>
                          ) : r.paymentStatus === "PAID" ? (
                            <button
                              onClick={() => handleEmailAction(r.id, "send_seat_invite")}
                              disabled={reminderState[`send_seat_invite:${r.id}`] === "sending"}
                              aria-live="polite"
                              className={`text-xs px-3.5 py-2 rounded-full border whitespace-nowrap min-w-[8.5rem] transition-colors ${
                                reminderState[`send_seat_invite:${r.id}`] === "sent"
                                  ? "border-emerald-400/60 text-emerald-400"
                                  : reminderState[`send_seat_invite:${r.id}`] === "sending"
                                    ? "border-gold/60 text-goldlight opacity-80 cursor-wait"
                                    : "border-border text-fg hover:border-gold"
                              }`}
                            >
                              {reminderState[`send_seat_invite:${r.id}`] === "sending"
                                ? "Sending…"
                                : reminderState[`send_seat_invite:${r.id}`] === "sent"
                                  ? "Sent ✓"
                                  : r.seatInviteSentAt
                                    ? "Resend seat invite"
                                    : "Send seat invite"}
                            </button>
                          ) : (
                            <div className="flex flex-col items-center">
                              <button
                                onClick={() => handleEmailAction(r.id, "send_payment_reminder")}
                                disabled={reminderState[`send_payment_reminder:${r.id}`] === "sending"}
                                aria-live="polite"
                                className={`text-xs px-3.5 py-2 rounded-full border whitespace-nowrap min-w-[10.5rem] transition-colors ${
                                  reminderState[`send_payment_reminder:${r.id}`] === "sent"
                                    ? "border-emerald-400/60 text-emerald-400"
                                    : reminderState[`send_payment_reminder:${r.id}`] === "sending"
                                      ? "border-gold/60 text-goldlight opacity-80 cursor-wait"
                                      : "border-border text-fg hover:border-gold"
                                }`}
                              >
                                {reminderState[`send_payment_reminder:${r.id}`] === "sending"
                                  ? "Sending…"
                                  : reminderState[`send_payment_reminder:${r.id}`] === "sent"
                                    ? "Sent ✓"
                                    : "Send payment reminder"}
                              </button>
                              <span className="text-[11px] text-muted mt-1.5 whitespace-nowrap">{lastReminderLabel(r)}</span>
                            </div>
                          )}
                          <RegistrationActionsMenu
                            variant="payment"
                            paymentStatus={r.paymentStatus}
                            seatInviteSentAt={r.seatInviteSentAt}
                            seatChoice={r.seatLabel ? `Seat ${r.seatLabel}` : r.attendanceMode === "ONLINE" ? "Attending online" : null}
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
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={changePageSize} />
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
      {picking && (
        <RecordPaymentPicker
          onClose={() => setPicking(false)}
          onPick={(row) => {
            setPicking(false);
            setActiveRow(row);
          }}
        />
      )}
    </AdminShell>
  );
}

/** Finds a registrant by name, email or phone so a payment can be recorded for someone who is not in the list yet. */
function RecordPaymentPicker({ onClose, onPick }: { onClose: () => void; onPick: (row: RegistrationRow) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistrationRow[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/registrations?search=${encodeURIComponent(q)}&pageSize=8&stats=0`);
        if (res.ok) setResults((await res.json()).registrations);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4 py-6 overflow-y-auto">
      <div className="w-full max-w-md bg-cardbg border border-border rounded-2xl p-6 my-auto">
        <p className="text-xs uppercase tracking-wider text-muted mb-1">Payments</p>
        <h3 className="font-serif text-xl mb-4">Record a payment</h3>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email or phone"
          className="w-full bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm mb-3 focus:outline-none focus:border-gold"
        />
        <div className="space-y-2 min-h-[3rem]">
          {searching && <p className="text-muted text-sm">Searching…</p>}
          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <p className="text-muted text-sm">Nobody found.</p>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => onPick(r)}
              className="w-full text-left border border-border rounded-lg px-4 py-3 hover:border-gold"
            >
              <span className="block text-sm font-medium">{r.fullName}</span>
              <span className="block text-xs text-muted">
                {r.email} · {PAYMENT_META[r.paymentStatus].label}
              </span>
            </button>
          ))}
        </div>
        <div className="flex justify-end mt-5">
          <button onClick={onClose} className="text-sm px-4 py-2.5 rounded-full border border-border text-muted hover:text-fg">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}