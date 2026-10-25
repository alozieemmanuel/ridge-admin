"use client";

import { BASE_PATH, slugFromPathname } from "@/lib/basePath";

/**
 * Makes every browser call to our own API work under the base path and know which event it is about.
 * The pages simply call fetch("/api/admin/..."). This wrapper (installed once, when the dashboard loads):
 *   1. puts the base path in front, because Next only does that for links and the router, not for fetch;
 *   2. adds the event the admin is looking at (the address after /event/) as an x-event header.
 * The server never trusts the header on its own: every request is checked against the signed-in admin's access to that event.
 */
declare global {
  interface Window {
    __eventFetchInstalled?: boolean;
  }
}

export function currentEventSlug(): string {
  return typeof window === "undefined" ? "" : slugFromPathname(window.location.pathname);
}

/** A same-site link to an API address that a plain <a href> can follow (downloads), carrying the event in the address. */
export function apiHref(path: string): string {
  const slug = currentEventSlug();
  return `${BASE_PATH}${path}${slug ? `${path.includes("?") ? "&" : "?"}event=${encodeURIComponent(slug)}` : ""}`;
}

if (typeof window !== "undefined" && !window.__eventFetchInstalled) {
  window.__eventFetchInstalled = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith("/api/")) {
      const headers = new Headers(init?.headers);
      const slug = currentEventSlug();
      if (slug && !headers.has("x-event")) headers.set("x-event", slug);
      return original(`${BASE_PATH}${input}`, { ...init, headers });
    }
    return original(input, init);
  };
}
