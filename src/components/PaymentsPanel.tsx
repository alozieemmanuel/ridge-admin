"use client";

import { useEffect, useState } from "react";
import { CURRENCIES, PAY_METHODS, formatPrice, paymentFrom, paymentProblem, type PaymentConfig } from "@/lib/payments";
import { inputClass, primaryButton } from "@/components/ui";

const label = "block text-sm font-medium mb-1.5";

/** Shared by the wizard and Settings: price, currency and how guests pay. */
export function PaymentFields({ value, onChange }: { value: PaymentConfig; onChange: (v: PaymentConfig) => void }) {
  const method = PAY_METHODS.find((m) => m.id === value.method) ?? PAY_METHODS[0];
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="pay-price" className={label}>
            Ticket price
          </label>
          <input id="pay-price" inputMode="decimal" value={value.price} onChange={(e) => onChange({ ...value, price: e.target.value.replace(/[^\d.,]/g, "").slice(0, 14) })} placeholder="25000" className={inputClass} />
        </div>
        <div>
          <label htmlFor="pay-cur" className={label}>
            Currency
          </label>
          <select id="pay-cur" value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value })} className={inputClass}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className={label}>How do guests pay?</p>
        <div className="grid sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Payment method">
          {PAY_METHODS.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={value.method === m.id} onClick={() => onChange({ ...value, method: m.id, details: "" })} className={`text-left rounded-xl border p-4 transition-colors ${value.method === m.id ? "border-gold bg-gold/10" : "border-border hover:border-gold/60"}`}>
              <span className="block font-medium text-sm">{m.label}</span>
              <span className="block text-xs text-muted mt-1">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="pay-details" className={label}>
          {method.field}
        </label>
        {value.method === "link" ? (
          <input id="pay-details" value={value.details} onChange={(e) => onChange({ ...value, details: e.target.value })} placeholder={method.placeholder} className={inputClass} />
        ) : (
          <textarea id="pay-details" rows={4} value={value.details} onChange={(e) => onChange({ ...value, details: e.target.value })} placeholder={method.placeholder} className={inputClass} />
        )}
        <p className="text-xs text-muted mt-1.5">Guests see the price and this on their page{value.price ? `: ${formatPrice(value.price, value.currency)}` : ""}.</p>
      </div>
    </div>
  );
}

/** Owner only, paid events only: edit the price and payment method. */
export default function PaymentsPanel() {
  const [cfg, setCfg] = useState<PaymentConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCfg(paymentFrom(d.settings ?? {})))
      .catch(() => setMessage({ text: "Could not load the settings.", ok: false }));
  }, []);

  if (!cfg) return <p className="text-muted">{message?.text ?? "Loading…"}</p>;

  async function save() {
    if (!cfg) return;
    const problem = paymentProblem(cfg);
    if (problem) return setMessage({ text: problem, ok: false });
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pay_price: cfg.price.replace(/,/g, "").trim(), pay_currency: cfg.currency, pay_method: cfg.method, pay_details: cfg.details.trim() }),
    }).catch(() => null);
    setBusy(false);
    setMessage(res?.ok ? { text: "Saved.", ok: true } : { text: "Could not save.", ok: false });
  }

  return (
    <div className="border border-border rounded-xl p-6 max-w-3xl">
      <h3 className="font-serif text-xl mb-1">Payments</h3>
      <p className="text-sm text-muted mb-6">The ticket price and how guests pay. They appear on each guest&apos;s page. In email templates you can use {"{{ticket_price}}"} and {"{{payment_instructions}}"}.</p>
      <PaymentFields value={cfg} onChange={setCfg} />
      <div className="flex items-center gap-3 flex-wrap mt-7">
        <button className={primaryButton} disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save payments"}
        </button>
        {message && <span className={`text-sm ${message.ok ? "text-muted" : "text-red-400"}`}>{message.text}</span>}
      </div>
      <p className="text-xs text-muted mt-6">Card checkout and automatic payment tracking are not built yet. Guests pay by the method above and you follow up from the Contacts page.</p>
    </div>
  );
}
