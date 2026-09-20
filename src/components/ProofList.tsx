"use client";

export interface ProofInfo {
  id: string;
  fileName: string;
  currency: string;
  method: string | null;
  amountClaimed: number | null;
  expectedAmount: number | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
}

const SYMBOL: Record<string, string> = { USD: "$", CAD: "C$", NGN: "₦", USD_NG: "US$" };
const CURRENCY_NAME: Record<string, string> = { USD: "USD", CAD: "CAD", NGN: "Naira", USD_NG: "USD (Nigeria)" };

/** Currencies that are the same as the programme currency, so a claimed amount can be applied directly. */
export const PROGRAMME_CURRENCY_CODES = new Set(["USD", "USD_NG"]);

export function claimedText(p: ProofInfo): string {
  if (p.amountClaimed === null) return "Amount not stated";
  return `${SYMBOL[p.currency] ?? ""}${p.amountClaimed.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** "Full" / "Part" as claimed by the participant against the fee they were shown; null if unknown. */
export function claimKind(p: ProofInfo): "Full" | "Part" | null {
  if (p.amountClaimed === null || p.expectedAmount === null) return null;
  return p.amountClaimed >= p.expectedAmount ? "Full" : "Part";
}

/** Suggested new total for the payment dialog: what's on file plus pending receipts, when they're in the programme currency. */
export function suggestedTotal(amountPaid: number, proofs: ProofInfo[]): number | undefined {
  const pending = proofs.filter((p) => p.status === "PENDING");
  if (pending.length === 0) return undefined;
  if (!pending.every((p) => p.amountClaimed !== null && PROGRAMME_CURRENCY_CODES.has(p.currency))) return undefined;
  return amountPaid + pending.reduce((sum, p) => sum + (p.amountClaimed ?? 0), 0);
}

const STATUS_STYLE: Record<ProofInfo["status"], string> = {
  PENDING: "border-amber-400/40 text-amber-300",
  APPROVED: "border-emerald-400/40 text-emerald-300",
  REJECTED: "border-red-400/40 text-red-300",
};

/** The payment receipts a participant uploaded, with what they claim to have paid and a link to view each one. */
export default function ProofList({ proofs, onReject }: { proofs: ProofInfo[]; onReject?: (proof: ProofInfo) => void }) {
  if (proofs.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {proofs.map((p) => {
        const kind = claimKind(p);
        return (
          <div key={p.id} className="text-xs leading-tight">
            <span className="text-fg">
              {kind ? `${kind} payment · ` : ""}
              {claimedText(p)}
            </span>
            <span className="text-muted">
              {" "}
              {CURRENCY_NAME[p.currency] ?? p.currency}
              {p.method ? ` · ${p.method.replace("_", " ")}` : ""}
            </span>
            <span className={`ml-2 rounded-full border px-2 py-0.5 ${STATUS_STYLE[p.status]}`}>{p.status.toLowerCase()}</span>
            <div className="mt-0.5 space-x-3">
              <a
                href={`/api/admin/payment-proofs/${p.id}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`${p.fileName} · uploaded ${new Date(p.createdAt).toLocaleString()}`}
                className="text-goldlight underline underline-offset-4"
              >
                View receipt
              </a>
              {onReject && p.status === "PENDING" && (
                <button onClick={() => onReject(p)} className="text-red-400 underline underline-offset-4">
                  Reject
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}