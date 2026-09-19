"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `callback` every `intervalMs` while the tab is visible, and once more
 * the moment the admin returns to the tab — so new registrations appear
 * without a manual page refresh.
 *
 * This is polling rather than a push connection on purpose: the app runs as
 * serverless functions on Vercel, which can't hold a websocket open.
 */
export function useAutoRefresh(callback: () => void | Promise<void>, intervalMs = 10_000) {
  const latest = useRef(callback);

  useEffect(() => {
    latest.current = callback;
  }, [callback]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void latest.current();
    };
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs]);
}
