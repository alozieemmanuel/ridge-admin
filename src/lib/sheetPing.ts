import { createHmac, timingSafeEqual } from "crypto";
import { BASE_PATH } from "@/lib/basePath";
import { appBaseUrl } from "@/lib/email";
import { syncContactSheet } from "@/lib/contactSheet";

/**
 * "Sheet ping": the Google Sheet's own script calls this app the moment a row is added, and the app reads the sheet at once.
 * The key is derived from SESSION_SECRET and the event id, so there is nothing to store and every event has its own.
 */
export function pingKey(eventId: string): string {
  const secret = process.env.SESSION_SECRET || "";
  return createHmac("sha256", secret).update(`sheet-ping:${eventId}`).digest("hex").slice(0, 32);
}

export function pingKeyIsValid(eventId: string, given: string): boolean {
  const a = Buffer.from(pingKey(eventId));
  const b = Buffer.from(given || "");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The address the sheet's script calls, for one event. */
export function pingUrl(slug: string, eventId: string): string {
  return `${appBaseUrl()}${BASE_PATH}/api/public/sheet-ping/${slug}?key=${pingKey(eventId)}`;
}

// ---- One read at a time per event ----
// People may register every second. Pings that arrive while a read is running are folded into ONE more read right after it,
// and reads are at least MIN_GAP_MS apart, so the sheet is never hammered.
const MIN_GAP_MS = 3_000;
const MAX_LOOP_MS = 50_000;
const running = new Map<string, { again: boolean }>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function requestSheetSync(eventId: string): Promise<void> {
  const state = running.get(eventId);
  if (state) {
    state.again = true;
    return;
  }
  const mine = { again: false };
  running.set(eventId, mine);
  const begun = Date.now();
  try {
    do {
      mine.again = false;
      const started = Date.now();
      try {
        await syncContactSheet(eventId);
      } catch (err) {
        console.error("[sheet-ping] sync failed:", err instanceof Error ? err.message : err);
      }
      if (mine.again) await sleep(Math.max(0, MIN_GAP_MS - (Date.now() - started)));
    } while (mine.again && Date.now() - begun < MAX_LOOP_MS);
  } finally {
    running.delete(eventId);
  }
}
