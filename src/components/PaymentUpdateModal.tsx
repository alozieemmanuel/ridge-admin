"use client";

import { useEffect, useState } from "react";
import { claimedText, claimKind, type ProofInfo } from "@/components/ProofList";
import { paidText, usdText } from "@/lib/receipt";

export type PaymentStatus = "NOT_PAID" | "PARTIAL" | "PAID";

export const PAYMENT_META: Record<PaymentStatus, { label: string; className: string }> = {
  NOT_PAID: { label: "Not paid", className: "border-red-400/40 text-red-300" },
  PARTIAL: { label: "Partial", className: "border-amber-400/40 text-amber-300" },
  PAID: { label: "Paid", className: "border-emerald-400/40 text-emerald-300" },
};

export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function deriveStatus(amount: number, expectedFee: number | null): PaymentStatus {
  if (amount <= 0) return "NOT_PAID";
  if (expectedFee !== null && amount >= expectedFee) return "PAID";
  return "PARTIAL";
}

/** Currency and expected fees, needed by the payment modal on any page that opens it. */
export function usePaymentSettings() {
  const [currency, setCurrency] = useState("USD");
  const [feeAmounts, setFeeAmounts] = useState<{ early: number | null; late: number | null }>({
    early: null,
    late: null,
  });

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        setCurrency(data.settings.currency || "USD");
        const early = parseFloat(data.settings.registration_fee_amount);
        const late = parseFloat(data.settings.late_registration_fee_amount);
        setFeeAmounts({
          early: Number.isFinite(early) ? early : null,
          late: Number.isFinite(late) ? late : null,
        });
      })
      .catch(() => {
        // Keep defaults. The modal still works, it just can't preview the derived status.
      });
  }, []);

  return { currency, feeAmounts };
}

export type PayCurrency = "USD" | "USD_NG" | "CAD" | "NGN";

const CURRENCY_OPTIONS: { value: PayCurrency; label: string; code: string }[] = [
  { value: "USD", label: "USD", code: "USD" },
  { value: "USD_NG", label: "USD (Nigeria)", code: "USD" },
  { value: "CAD", label: "CAD (Canadian dollar)", code: "CAD" },
  { value: "NGN", label: "Naira (NGN)", code: "NGN" },
];

const isUsdCurrency = (c: PayCurrency) => c === "USD" || c === "USD_NG";

/** Starting exchange rates (units per 1 USD) from Settings. */
function useExchangeRates() {
  const [rates, setRates] = useState<{ NGN: number; CAD: number }>({ NGN: 1400, CAD: 1.4 });
  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        const ngn = parseFloat(data.settings.rate_ngn_per_usd);
        const cad = parseFloat(data.settings.rate_cad_per_usd);
        setRates({ NGN: Number.isFinite(ngn) && ngn > 0 ? ngn : 1400, CAD: Number.isFinite(cad) && cad > 0 ? cad : 1.4 });
      })
      .catch(() => {
        // keep the built-in defaults
      });
  }, []);
  return rates;
}

export interface ConfirmedPayment {
  currency: PayCurrency;
  amount: number;
  rate: number;
}

export function PaymentUpdateModal({
  row,
  currency,
  expectedFee,
  onClose,
  onConfirm,
  pendingProofs = [],
  initialAmount,
}: {
  row: { fullName: string; amountPaid: number };
  currency: string;
  expectedFee: number | null;
  onClose: () => void;
  /** Receipts waiting for approval; confirming this payment approves them. */
  pendingProofs?: ProofInfo[];
  /** Pre-filled total (USD) for the "correct the total" mode. */
  initialAmount?: number;
  onConfirm: (
    amountPaid: number,
    note: string,
    opts: { sendConfirmation: boolean; approveProofIds: string[]; payment?: ConfirmedPayment }
  ) => Promise<void>;
}) {
  const rates = useExchangeRates();
  const firstProof = pendingProofs.find((p) => p.amountClaimed !== null && CURRENCY_OPTIONS.some((o) => o.value === p.currency));

  const [step, setStep] = useState<"input" | "confirm">("input");
  // "add": record a payment in the currency it was received in. "total": overwrite the USD total (a correction).
  const [mode, setMode] = useState<"add" | "total">("add");
  const [payCurrency, setPayCurrency] = useState<PayCurrency>((firstProof?.currency as PayCurrency) ?? "USD");
  const [amountText, setAmountText] = useState(firstProof?.amountClaimed != null ? String(firstProof.amountClaimed) : "");
  const [rateText, setRateText] = useState("");
  const [rateTouched, setRateTouched] = useState(false);
  const [totalText, setTotalText] = useState(initialAmount !== undefined ? String(initialAmount) : "");
  // Approving a participant's receipt is the moment they get told their payment is confirmed.
  const [sendConfirmation, setSendConfirmation] = useState(pendingProofs.length > 0);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Start from the rate in Settings for the chosen currency, until the admin edits it.
  useEffect(() => {
    if (rateTouched) return;
    if (payCurrency === "NGN") setRateText(String(rates.NGN));
    else if (payCurrency === "CAD") setRateText(String(rates.CAD));
    else setRateText("1");
  }, [payCurrency, rates, rateTouched]);

  const usdCurrency = isUsdCurrency(payCurrency);
  const code = CURRENCY_OPTIONS.find((o) => o.value === payCurrency)?.code ?? "USD";
  const amount = parseFloat(amountText);
  const rate = usdCurrency ? 1 : parseFloat(rateText);
  const validAdd = amountText.trim() !== "" && amount > 0 && rate > 0;
  const usdEquivalent = validAdd ? Math.round((amount / rate) * 100) / 100 : null;

  const totalInput = parseFloat(totalText);
  const validTotal = totalText.trim() !== "" && !Number.isNaN(totalInput) && totalInput >= 0;

  const newTotal =
    mode === "add" ? (usdEquivalent !== null ? Math.round((row.amountPaid + usdEquivalent) * 100) / 100 : null) : validTotal ? totalInput : null;
  const previewStatus = newTotal !== null ? deriveStatus(newTotal, expectedFee) : null;

  function handleContinue() {
    if (mode === "add" && !validAdd) {
      setError(usdCurrency ? "Enter the amount received." : "Enter the amount received and a valid exchange rate.");
      return;
    }
    if (mode === "total" && !validTotal) {
      setError("Enter a valid amount (0 or more).");
      return;
    }
    setError(null);
    setStep("confirm");
  }

  async function handleConfirm() {
    if (newTotal === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(newTotal, note, {
        sendConfirmation: sendConfirmation && previewStatus !== "NOT_PAID",
        approveProofIds: pendingProofs.map((p) => p.id),
        ...(mode === "add" ? { payment: { currency: payCurrency, amount, rate } } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update payment.");
      setSubmitting(false);
      return;
    }
  }

  const inputClass = "w-full bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold";
  const labelClass = "block text-xs uppercase tracking-wider text-muted mb-2";

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4 overflow-y-auto py-6">
      <div className="w-full max-w-md bg-cardbg border border-border rounded-2xl p-6 my-auto">
        <p className="text-xs uppercase tracking-wider text-muted mb-1">Update payment</p>
        <h3 className="font-serif text-xl mb-5">{row.fullName}</h3>

        {step === "input" && (
          <>
            {pendingProofs.length > 0 && (
              <div className="border border-amber-400/30 rounded-xl p-3 mb-4 text-xs text-muted space-y-1">
                <p className="text-amber-300">
                  {pendingProofs.length} receipt{pendingProofs.length === 1 ? "" : "s"} waiting for approval
                </p>
                {pendingProofs.map((p) => (
                  <p key={p.id}>
                    {claimKind(p) ? `${claimKind(p)} payment · ` : ""}claims {claimedText(p)} ·{" "}
                    <a
                      href={`/api/admin/payment-proofs/${p.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-goldlight underline underline-offset-4"
                    >
                      view receipt
                    </a>
                  </p>
                ))}
                <p>Check the receipt against your bank, then enter what you actually received. Confirming approves the receipt(s).</p>
              </div>
            )}

            {mode === "add" ? (
              <>
                <label className={labelClass}>Currency paid in</label>
                <select
                  value={payCurrency}
                  onChange={(e) => {
                    setPayCurrency(e.target.value as PayCurrency);
                    setRateTouched(false);
                  }}
                  className={`${inputClass} mb-4`}
                >
                  {CURRENCY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>

                <label className={labelClass}>Amount received ({code})</label>
                <input
                  autoFocus
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  placeholder="0"
                  className={`${inputClass} mb-3`}
                />

                {!usdCurrency && (
                  <div className="flex items-center gap-2 mb-2 text-sm text-muted">
                    <span className="whitespace-nowrap">1 USD =</span>
                    <input
                      inputMode="decimal"
                      value={rateText}
                      onChange={(e) => {
                        setRateText(e.target.value);
                        setRateTouched(true);
                      }}
                      className="w-32 bg-inputbg border border-border rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-gold"
                    />
                    <span>{code}</span>
                  </div>
                )}

                <p className="text-xs text-muted mb-4">
                  {usdEquivalent !== null && !usdCurrency ? (
                    <>
                      Equals <span className="text-fg">{usdText(usdEquivalent)}</span>.{" "}
                    </>
                  ) : null}
                  On file: {formatMoney(row.amountPaid, currency)}.
                  {newTotal !== null ? (
                    <>
                      {" "}
                      After this payment: <span className="text-fg">{formatMoney(newTotal, currency)}</span>
                      {expectedFee !== null ? ` of ${formatMoney(expectedFee, currency)}` : ""}.
                    </>
                  ) : expectedFee !== null ? (
                    ` Expected fee is ${formatMoney(expectedFee, currency)}.`
                  ) : null}
                </p>
              </>
            ) : (
              <>
                <label className={labelClass}>Total received to date ({currency})</label>
                <input
                  autoFocus
                  inputMode="decimal"
                  value={totalText}
                  onChange={(e) => setTotalText(e.target.value)}
                  placeholder={row.amountPaid ? String(row.amountPaid) : "0"}
                  className={`${inputClass} mb-1`}
                />
                <p className="text-xs text-muted mb-4">
                  Currently on file: {formatMoney(row.amountPaid, currency)}. This replaces the total (use it to correct a mistake)
                  {expectedFee !== null ? `. Expected fee is ${formatMoney(expectedFee, currency)}.` : "."}
                </p>
              </>
            )}

            <label className={labelClass}>
              Note <span className="normal-case text-muted/70">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. bank transfer ref, part of a split payment…"
              className={`${inputClass} mb-2 resize-none`}
            />

            <button
              type="button"
              onClick={() => {
                setMode(mode === "add" ? "total" : "add");
                setError(null);
              }}
              className="text-xs text-muted underline underline-offset-4 hover:text-fg"
            >
              {mode === "add" ? "Correct the total instead" : "Record a payment instead"}
            </button>

            {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

            <div className="flex items-center justify-end gap-3 mt-6">
              <button onClick={onClose} className="text-sm px-4 py-2.5 rounded-full border border-border text-muted hover:text-fg">
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

        {step === "confirm" && previewStatus && newTotal !== null && (
          <>
            <div className="border border-border rounded-xl p-4 mb-5 space-y-2">
              {mode === "add" ? (
                <>
                  <div className="flex justify-between text-sm gap-4">
                    <span className="text-muted">Payment received</span>
                    <span className="text-right">{paidText(payCurrency, amount)}</span>
                  </div>
                  {!usdCurrency && usdEquivalent !== null && (
                    <div className="flex justify-between text-sm gap-4">
                      <span className="text-muted">USD equivalent</span>
                      <span className="text-right">
                        {usdText(usdEquivalent)}
                        <span className="block text-xs text-muted">1 USD = {rate.toLocaleString("en-US", { maximumFractionDigits: 4 })} {code}</span>
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm gap-4">
                    <span className="text-muted">Total received to date</span>
                    <span>{formatMoney(newTotal, currency)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Total received (corrected)</span>
                  <span>{formatMoney(newTotal, currency)}</span>
                </div>
              )}
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
              <span className="text-fg">{PAYMENT_META[previewStatus].label.toLowerCase()}</span> and record today&apos;s
              date as the payment update date. Continue?
            </p>

            {previewStatus !== "NOT_PAID" && (
              <label className="flex items-start gap-2 text-sm text-muted mb-5 normal-case tracking-normal font-normal cursor-pointer">
                <input type="checkbox" checked={sendConfirmation} onChange={(e) => setSendConfirmation(e.target.checked)} className="mt-1" />
                <span>
                  Email <span className="text-fg">{row.fullName}</span> a payment confirmation
                  {mode === "add" ? ` showing ${paidText(payCurrency, amount)}` : ""}
                  {pendingProofs.length === 0 ? " (off by default, no receipt is waiting)" : ""}
                </span>
              </label>
            )}

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
