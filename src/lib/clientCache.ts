/**
 * A tiny in-browser cache so pages can show the data they had last time straight away
 * and refresh it quietly in the background ("stale while revalidate").
 *
 * It lives in memory for as long as the admin keeps the dashboard open, and it survives
 * switching between modules (the tabs), which is exactly when the delay was noticeable.
 */

const store = new Map<string, unknown>();

export function cacheGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function cacheSet(key: string, value: unknown): void {
  store.set(key, value);
}

/** Forgets everything (used on sign-out so the next admin never sees the previous one's data). */
export function cacheClear(): void {
  store.clear();
}

/** Forgets every remembered response whose URL starts with `prefix` (after a change, so a list never shows what it had before the change). */
export function cacheDeletePrefix(prefix: string): void {
  for (const key of Array.from(store.keys())) if (key.startsWith(prefix)) store.delete(key);
}

/** Fetches JSON, remembers it under the URL, and returns it (null when the request fails). */
export async function fetchAndCache<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    store.set(url, data);
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rows per page: remembered in this browser so it doesn't reset on every visit.
// ---------------------------------------------------------------------------

export const PAGE_SIZES = [25, 50, 100, 200] as const;
const PAGE_SIZE_KEY = "hangout-admin-page-size";

export function getStoredPageSize(): number {
  try {
    const v = parseInt(window.localStorage.getItem(PAGE_SIZE_KEY) || "", 10);
    if ((PAGE_SIZES as readonly number[]).includes(v)) return v;
  } catch {
    // storage can be blocked; fall back to the default
  }
  return 50;
}

export function storePageSize(size: number): void {
  try {
    window.localStorage.setItem(PAGE_SIZE_KEY, String(size));
  } catch {
    // ignore
  }
}
