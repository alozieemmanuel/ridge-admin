"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import EventCard, { type EventCardData } from "@/components/EventCard";
import { inputClass, primaryButton } from "@/components/ui";
import { cacheGet, cacheSet } from "@/lib/clientCache";

interface EventRow extends EventCardData {
  id: string;
  createdAt: string;
}
interface Response {
  isOwner: boolean;
  events: EventRow[];
}

const URL = "/api/events";
type Filter = "active" | "draft" | "archived" | "all";

function Skeleton() {
  return (
    <div className="rounded-2xl border border-border bg-cardbg overflow-hidden animate-pulse" aria-hidden>
      <div className="h-[8.5rem] bg-tint" />
      <div className="p-5 space-y-3">
        <div className="h-5 w-2/3 rounded bg-tint" />
        <div className="h-4 w-1/2 rounded bg-tint" />
        <div className="h-16 rounded bg-tint mt-5" />
      </div>
    </div>
  );
}

function Total({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="font-serif text-4xl leading-none tabular-nums">{value.toLocaleString()}</p>
      <p className="text-sm text-muted mt-2">{label}</p>
    </div>
  );
}

/** The screen after sign-in: every event this admin can open, each as a card in its own colour. */
export default function EventsPage() {
  const router = useRouter();
  const [data, setData] = useState<Response | null>(() => cacheGet<Response>(URL) ?? null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch(URL, { cache: "no-store" })
      .then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          return Promise.reject();
        }
        return res.ok ? res.json() : Promise.reject();
      })
      .then((json: Response) => {
        cacheSet(URL, json);
        setData(json);
        setError(false);
      })
      .catch(() => setError(true));
  }, [router]);

  const events = data?.events ?? [];
  const counts = useMemo(
    () => ({
      active: events.filter((e) => e.status === "ACTIVE").length,
      draft: events.filter((e) => e.status === "DRAFT").length,
      archived: events.filter((e) => e.status === "ARCHIVED").length,
      all: events.length,
    }),
    [events]
  );

  const live = events.filter((e) => e.status === "ACTIVE");
  const totals = {
    people: live.reduce((n, e) => n + e.total, 0),
    reserved: live.reduce((n, e) => n + e.reserved, 0),
    checked: live.reduce((n, e) => n + e.checkedIn, 0),
  };

  const q = query.trim().toLowerCase();
  const shown = events.filter((e) => (filter === "all" || e.status === filter.toUpperCase()) && (!q || `${e.name} ${e.brandName ?? ""} ${e.slug}`.toLowerCase().includes(q)));
  const tabs: { id: Filter; label: string }[] = [
    { id: "active", label: "Active" },
    ...(counts.draft ? [{ id: "draft" as Filter, label: "Drafts" }] : []),
    ...(counts.archived ? [{ id: "archived" as Filter, label: "Archived" }] : []),
    { id: "all", label: "All" },
  ];
  const owner = Boolean(data?.isOwner);

  return (
    <AdminShell>
      <div className="flex items-end justify-between flex-wrap gap-5 mb-8">
        <div>
          <h1 className="font-serif text-4xl">Your events</h1>
          <p className="text-muted mt-2 max-w-xl">Open an event to manage its contacts, invitations, attendance and emails.</p>
        </div>
        {owner && events.length > 0 && (
          <Link href="/new" className={primaryButton}>
            New event
          </Link>
        )}
      </div>

      {data && counts.active > 0 && (
        <div className="flex flex-wrap gap-x-14 gap-y-5 mb-9 pb-8 border-b border-border">
          <Total value={counts.active} label={counts.active === 1 ? "active event" : "active events"} />
          <Total value={totals.people} label="people across them" />
          <Total value={totals.reserved} label="seats reserved" />
          <Total value={totals.checked} label="checked in" />
        </div>
      )}

      {data && events.length > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
          <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Filter events">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={filter === t.id}
                onClick={() => setFilter(t.id)}
                className={`text-sm px-4 py-2 rounded-full border transition-colors ${filter === t.id ? "border-gold bg-gold/15 font-medium" : "border-border text-muted hover:text-fg hover:border-gold/60"}`}
              >
                {t.label} <span className="opacity-60 ml-0.5">{counts[t.id]}</span>
              </button>
            ))}
          </div>
          {events.length > 3 && <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events" aria-label="Search events" className={`${inputClass} sm:w-64`} />}
        </div>
      )}

      {error && !data && (
        <p className="text-sm text-red-400 mb-4" role="alert">
          Couldn&apos;t load your events. Check your connection and refresh the page.
        </p>
      )}

      {!data && !error && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}

      {data && events.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 max-w-xl">
          <h2 className="font-serif text-2xl mb-2">{owner ? "Create your first event" : "No events yet"}</h2>
          <p className="text-muted mb-6">{owner ? "Give it a name, colour and logo, choose what it needs, and connect your contact list. It takes about three minutes." : "Ask an owner to add you to an event. It will appear here."}</p>
          {owner && (
            <Link href="/new" className={primaryButton}>
              Create an event
            </Link>
          )}
        </div>
      )}

      {data && events.length > 0 && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
          {shown.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
          {owner && !q && (filter === "active" || filter === "all") && (
            <Link href="/new" className="rounded-2xl border border-dashed border-border hover:border-gold hover:bg-gold/5 transition-colors min-h-[16rem] flex flex-col items-center justify-center gap-3 text-center p-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold">
              <span className="h-12 w-12 rounded-full border border-border grid place-items-center text-2xl text-muted" aria-hidden>
                +
              </span>
              <span className="font-medium">Create an event</span>
              <span className="text-sm text-muted max-w-[14rem]">Its own contacts, colour, logo, emails and live sheet.</span>
            </Link>
          )}
          {shown.length === 0 && (
            <p className="text-muted col-span-full">{q ? `No events match "${query}".` : `No ${filter} events.`}</p>
          )}
        </div>
      )}
    </AdminShell>
  );
}
