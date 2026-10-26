/** What a paid event asks for: a price, a currency and how guests pay. Kept in the event's settings (pay_*). Safe for client code. */

export const CURRENCIES = [
  { code: "NGN", symbol: "₦", label: "Nigerian naira (₦)" },
  { code: "USD", symbol: "$", label: "US dollar ($)" },
  { code: "GBP", symbol: "£", label: "British pound (£)" },
  { code: "EUR", symbol: "€", label: "Euro (€)" },
  { code: "GHS", symbol: "GH₵", label: "Ghanaian cedi (GH₵)" },
  { code: "KES", symbol: "KSh ", label: "Kenyan shilling (KSh)" },
  { code: "ZAR", symbol: "R", label: "South African rand (R)" },
  { code: "CAD", symbol: "CA$", label: "Canadian dollar (CA$)" },
] as const;

export const PAY_METHODS = [
  { id: "bank", label: "Bank transfer", hint: "Guests pay into your account and send you proof.", field: "Bank details", placeholder: "Bank name\nAccount name\nAccount number" },
  { id: "link", label: "Payment link", hint: "A Paystack, Flutterwave or other link that you create.", field: "Payment link", placeholder: "https://paystack.com/pay/your-event" },
  { id: "door", label: "Pay at the door", hint: "Guests reserve now and pay when they arrive.", field: "Note to guests", placeholder: "Cash or transfer at the registration desk." },
] as const;

export const PAY_KEYS = ["pay_price", "pay_currency", "pay_method", "pay_details"] as const;

export interface PaymentConfig {
  price: string;
  currency: string;
  method: string;
  details: string;
}

export function paymentFrom(settings: Record<string, string | undefined>): PaymentConfig {
  return {
    price: settings.pay_price ?? "",
    currency: settings.pay_currency || "NGN",
    method: settings.pay_method || "bank",
    details: settings.pay_details ?? "",
  };
}

export function formatPrice(price: string | number, currency: string): string {
  const n = typeof price === "number" ? price : parseFloat(String(price).replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return "";
  const symbol = CURRENCIES.find((c) => c.code === currency)?.symbol ?? `${currency} `;
  return `${symbol}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** The sentence guests read about how to pay. */
export function paymentInstructions(cfg: PaymentConfig): string {
  const method = PAY_METHODS.find((m) => m.id === cfg.method);
  if (!method) return "";
  const details = cfg.details.trim();
  if (cfg.method === "link") return details ? `Pay online: ${details}` : "";
  if (cfg.method === "door") return details || "Pay at the door on the day.";
  return details ? `Pay by bank transfer:\n${details}` : "";
}

/** Returns an error message for a bad value, or null. */
export function paymentProblem(cfg: PaymentConfig): string | null {
  const price = parseFloat(cfg.price.replace(/,/g, ""));
  if (!cfg.price.trim() || !Number.isFinite(price) || price <= 0) return "Enter the ticket price as a number, for example 25000.";
  if (!CURRENCIES.some((c) => c.code === cfg.currency)) return "Choose a currency.";
  if (!PAY_METHODS.some((m) => m.id === cfg.method)) return "Choose how guests pay.";
  if (cfg.method === "link" && !/^https:\/\//.test(cfg.details.trim())) return "The payment link must start with https://.";
  if (cfg.method === "bank" && cfg.details.trim().length < 5) return "Add the bank details guests should pay into.";
  return null;
}
