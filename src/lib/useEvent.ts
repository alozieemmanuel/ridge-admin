"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { cacheGet, fetchAndCache } from "@/lib/clientCache";
import { lower, termsOf, type Terms } from "@/lib/eventTheme";

export interface EventInfo {
  id: string;
  slug: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  modules: string[];
  type: string;
  brandName: string | null;
  color: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  terms: Terms;
  timezone: string;
}
interface EventResponse {
  event: EventInfo;
  role: "OWNER" | "ADMIN";
  admin: { name: string; email: string };
}

/** The address of the open event (the part after /event/). Empty on screens that are not inside an event. */
export function useEventSlug(): string {
  const params = useParams();
  const slug = params?.slug;
  return typeof slug === "string" ? slug : "";
}

/** Builds an in-app link inside the open event: ep("/contacts") gives "/investor-hangout/contacts". */
export function useEventPath(): (path?: string) => string {
  const slug = useEventSlug();
  return (path = "") => `/${slug}${path}`;
}

/** What the open event calls its people: Contacts, Registrations, Guests... (lowercase versions included). */
export function useTerms() {
  const { event } = useEvent();
  const t = termsOf(event?.terms);
  return { ...t, lperson: lower(t.person), lpeople: lower(t.people) };
}

/** The open event, which parts of it are switched on, and who is looking. `denied` is true when it doesn't exist or the admin has no access. */
export function useEvent() {
  const slug = useEventSlug();
  const [data, setData] = useState<EventResponse | null>(() => (slug ? cacheGet<EventResponse>("/api/admin/event") ?? null : null));
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    fetchAndCache<EventResponse>("/api/admin/event").then((d) => {
      if (!alive) return;
      if (d) setData(d);
      else setDenied(true);
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  return {
    event: data?.event ?? null,
    role: data?.role ?? null,
    admin: data?.admin ?? null,
    isOwner: data?.role === "OWNER",
    has: (module: string) => Boolean(data?.event.modules.includes(module)),
    denied,
  };
}
