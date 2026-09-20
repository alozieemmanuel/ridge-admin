"use client";

import { useEffect, useState } from "react";
import { claimedText, claimKind, type ProofInfo } from "@/components/ProofList";

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
  /** Pre-filled "new total amount received". */
  initialAmount?: number;
  onConfirm: (
    amountPaid: number,
    note: string,
    opts: { sendConfirmation: boolean; approveProofIds: string[] }
  ) => Promise<void>;
}) {
  const [step, setStep] = useState<"input" | "confirm">("input");
  const [amountText, setAmountText] = useState(initialAmount !== undefined ? String(initialAmount) : "");
  // Approving a participant's receipt is the moment they get told their payment is confirmed.
  const [sendConfirmation, setSendConfirmation] = useState(pendingProofs.length > 0);
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
      await onConfirm(amount, note, {
        sendConfirmation: sendConfirmation && previewStatus !== "NOT_PAID",
        approveProofIds: pendingProofs.map((p) => p.id),
      });
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
                <p>
                  Check the receipt against your bank, then enter the total received in {currency}. Confirming approves
                  the receipt(s).
                </p>
              </div>
            )}

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
              Currently on file: {formatMoney(row.amountPaid, currency)}. Enter the new total amount received to date
              for this registration
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
              <span className="text-fg">{PAYMENT_META[previewStatus].label.toLowerCase()}</span> and record today&apos;s
              date as the payment update date. Continue?
            </p>

            {previewStatus !== "NOT_PAID" && (
              <label className="flex items-start gap-2 text-sm text-muted mb-5 normal-case tracking-normal font-normal cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendConfirmation}
                  onChange={(e) => setSendConfirmation(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  Email <span className="text-fg">{row.fullName}</span> a payment confirmation
                  {pendingProofs.length === 0 ? " (off by default — no receipt is waiting)" : ""}
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