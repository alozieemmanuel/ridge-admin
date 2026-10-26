import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { termsOf } from "@/lib/eventTheme";
import { EventSeedProvider } from "@/components/EventSeed";
import type { EventInfo } from "@/lib/useEvent";

const load = cache(async (slug: string): Promise<EventInfo | null> => {
  const e = await prisma.event.findUnique({
    where: { slug: slug.toLowerCase() },
    select: { id: true, slug: true, name: true, status: true, modules: true, type: true, dataSource: true, brandName: true, color: true, logoUrl: true, logoDarkUrl: true, terms: true, timezone: true },
  });
  if (!e) return null;
  return { ...e, terms: termsOf(e.terms) } as EventInfo;
});

/**
 * Runs on the server for every page of an event (the dashboard and the guest's reserve page).
 * It hands the event's colour, logo and name to the page so they are in the very first paint.
 */
export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await load(slug).catch(() => null);
  return <EventSeedProvider event={event}>{children}</EventSeedProvider>;
}
