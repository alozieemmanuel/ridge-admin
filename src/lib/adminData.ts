import { cacheGet, fetchAndCache, getStoredPageSize } from "@/lib/clientCache";
import { todayKey } from "@/lib/schedule";

/**
 * The exact request URLs the admin pages use for their first view. Pages and the
 * background warm-up share these builders, so the warm-up fills the very cache entry
 * the page will look for.
 */

export interface RegistrationsQuery {
  page: number;
  pageSize: number;
  search?: string;
  regType?: string; // "ALL" | "EARLY_BIRD" | "LATE"
  category?: string;
}

export function registrationsUrl(q: RegistrationsQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set("search", q.search);
  if (q.regType && q.regType !== "ALL") p.set("regType", q.regType);
  if (q.category) p.set("category", q.category);
  p.set("lean", "1");
  p.set("page", String(q.page));
  p.set("pageSize", String(q.pageSize));
  return `/api/admin/registrations?${p.toString()}`;
}

export interface PaymentsQuery {
  page: number;
  pageSize: number;
  search?: string;
  view: string; // "PAID_PARTIAL" | "PARTIAL" | "PAID" | "AWAITING"
}

export function paymentsUrl(q: PaymentsQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set("search", q.search);
  p.set("payView", q.view);
  p.set("page", String(q.page));
  p.set("pageSize", String(q.pageSize));
  return `/api/admin/registrations?${p.toString()}`;
}

export interface ProspectsQuery {
  page: number;
  pageSize: number;
  search?: string;
  filter: string;
  sourceId?: string;
}

export function prospectsUrl(q: ProspectsQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set("search", q.search);
  if (q.filter && q.filter !== "ALL") p.set("filter", q.filter);
  if (q.sourceId) p.set("sourceId", q.sourceId);
  // "today" is the admin's own date, so "calls due today" matches their clock.
  p.set("today", todayKey());
  p.set("page", String(q.page));
  p.set("pageSize", String(q.pageSize));
  return `/api/admin/prospects?${p.toString()}`;
}

let warmed = false;

/**
 * Quietly loads the first view of the busiest modules a moment after the dashboard opens,
 * one request at a time (the database pool is small), so clicking a tab shows data at once.
 */
export function warmAdminCache(): void {
  if (warmed || typeof window === "undefined") return;
  warmed = true;
  const size = getStoredPageSize();
  const urls = [
    registrationsUrl({ page: 1, pageSize: size, regType: "ALL" }),
    paymentsUrl({ page: 1, pageSize: size, view: "PAID_PARTIAL" }),
    prospectsUrl({ page: 1, pageSize: size, filter: "ALL" }),
    "/api/admin/settings",
  ];
  setTimeout(async () => {
    for (const url of urls) {
      if (cacheGet(url) === undefined) await fetchAndCache(url);
    }
  }, 1500);
}
