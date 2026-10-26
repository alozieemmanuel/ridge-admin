"use client";

import { createContext, useContext } from "react";
import type { EventInfo } from "@/lib/useEvent";

/**
 * The event's public details (name, colour, logo, wording), read on the server and sent with the page itself.
 * That lets the first paint already carry the event's colour and logo, instead of showing the default green
 * until the browser has asked the API for them.
 */
const SeedContext = createContext<EventInfo | null>(null);

export function EventSeedProvider({ event, children }: { event: EventInfo | null; children: React.ReactNode }) {
  return <SeedContext.Provider value={event}>{children}</SeedContext.Provider>;
}

export function useEventSeed(): EventInfo | null {
  return useContext(SeedContext);
}
