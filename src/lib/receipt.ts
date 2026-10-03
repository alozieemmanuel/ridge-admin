import type { ReceiptLine } from "@/lib/email";

// Pure helpers for the payment receipt email (no database access, so they are easy to test).

function formatReceiptDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
}

const PAID_CURRENCY: Record<string, { symbol: string; code: string; usd: boolean }> = {
  USD: { symbol: "$", code: "USD", usd: true },
  USD_NG: { symbol: "$", code: "USD", usd: true },
  CAD: { symbol: "C$", code: "CAD", usd: false },
  NGN: { symbol: "\u20A6", code: "NGN", usd: false },
};

export function usdText(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}USD ${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function humanMethod(method: string | null): string {
  if (!method) return "Payment";
  const text = method.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface ReceiptProofInput {
  currency: string;
  method: string | null;
  amountClaimed: number | null;
  expectedAmount: number | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

/**
 * Turns approved receipts into receipt lines: exact amount in the currency it
 * was paid in, the rate used, and the USD equivalent. The rate is the fee the
 * participant was quoted in that currency divided by the USD fee. A final line
 * covers any difference between the receipts and the total an admin confirmed,
 * so the receipt always adds up.
 */
export function buildReceiptLines(
  proofs: ReceiptProofInput[],
  fee: number | null,
  amountPaid: number,
  paymentUpdatedAt: Date | null
): { lines: ReceiptLine[]; anyForeign: boolean } {
  const lines: ReceiptLine[] = [];
  let usdFromReceipts = 0;
  let anyForeign = false;

  for (const p of proofs) {
    if (p.amountClaimed === null) continue;
    const info = PAID_CURRENCY[p.currency] ?? { symbol: "", code: p.currency, usd: false };
    const paid = `${info.symbol}${p.amountClaimed.toLocaleString("en-US", { maximumFractionDigits: 2 })} (${info.code})`;
    let perUsd: number | null = null;
    if (info.usd) perUsd = 1;
    else if (p.expectedAmount && fee) perUsd = p.expectedAmount / fee;

    const usd = perUsd ? p.amountClaimed / perUsd : null;
    if (!info.usd) anyForeign = true;
    if (usd !== null) usdFromReceipts += usd;

    lines.push({
      date: formatReceiptDate(p.reviewedAt ?? p.createdAt),
      method: humanMethod(p.method),
      paid,
      rate: info.usd ? "-" : perUsd ? `1 USD = ${perUsd.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${info.code}` : "Not available",
      usd: usd !== null ? usdText(usd) : "-",
    });
  }

  const diff = amountPaid - usdFromReceipts;
  if (lines.length === 0 || Math.abs(diff) > 0.5) {
    const value = lines.length === 0 ? amountPaid : diff;
    lines.push({
      date: formatReceiptDate(paymentUpdatedAt ?? new Date()),
      method: lines.length === 0 ? "Payment confirmed by RIDGE" : diff > 0 ? "Other payments recorded" : "Adjustment",
      paid: usdText(value),
      rate: "-",
      usd: usdText(value),
    });
  }
  return { lines, anyForeign };
}

export interface LedgerRecordInput {
  currency: string;
  amount: number;
  rate: number;
  usdAmount: number;
  receivedAt: Date;
}

/** "N2,800,000 (NGN)" style text for an amount in the currency it was paid in. */
export function paidText(currency: string, amount: number): string {
  const info = PAID_CURRENCY[currency] ?? { symbol: "", code: currency, usd: false };
  return `${info.symbol}${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} (${info.code})`;
}

/**
 * Receipt lines from the payments an admin recorded, each in the currency it was
 * received in, with the rate and USD equivalent. If the registration total is
 * more than these add up to (payments recorded before this existed), a line for
 * the difference keeps the receipt adding up.
 */
export function buildLedgerLines(
  records: LedgerRecordInput[],
  amountPaid: number
): { lines: ReceiptLine[]; anyForeign: boolean } {
  const lines: ReceiptLine[] = [];
  let sumUsd = 0;
  let anyForeign = false;

  for (const r of records) {
    const info = PAID_CURRENCY[r.currency] ?? { symbol: "", code: r.currency, usd: false };
    if (!info.usd) anyForeign = true;
    sumUsd += r.usdAmount;
    lines.push({
      date: formatReceiptDate(r.receivedAt),
      method: "Payment received",
      paid: paidText(r.currency, r.amount),
      rate: info.usd ? "-" : `1 USD = ${r.rate.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${info.code}`,
      usd: usdText(r.usdAmount),
    });
  }

  const diff = Math.round((amountPaid - sumUsd) * 100) / 100;
  if (Math.abs(diff) > 0.5) {
    const value = usdText(diff);
    lines.unshift({
      date: "Earlier",
      method: diff > 0 ? "Payments recorded earlier" : "Adjustment",
      paid: value,
      rate: "-",
      usd: value,
    });
  }
  return { lines, anyForeign };
}
