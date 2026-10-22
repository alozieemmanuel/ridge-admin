/**
 * Modules that exist in the code but are switched off for the Investor Hangout event.
 * Nothing is deleted: take a path out of these lists (and add the module back to the
 * sidebar in src/components/AdminShell.tsx) to bring it back.
 *
 * This file is imported by the middleware, so keep it free of Node-only code.
 */

/** Admin pages that redirect to the Overview instead of opening. */
export const HIDDEN_ADMIN_PAGES = [
  "/admin/prospects",
  "/admin/payments",
  "/admin/brochure-requests",
  "/admin/whatsapp",
];

/** Endpoints that answer 404 while their module is off (public forms, payment receipts, WhatsApp, and the matching admin APIs). */
export const DISABLED_API_PREFIXES = [
  "/api/public/registrations",
  "/api/public/brochure-requests",
  "/api/public/payment-info",
  "/api/public/payment-proofs",
  "/api/public/pay-later",
  "/api/webhooks/whatsapp",
  "/api/cron/pay-later-reminders",
  "/api/admin/prospects",
  "/api/admin/payment-proofs",
  "/api/admin/whatsapp",
  "/api/admin/brochure-requests",
];

export function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
