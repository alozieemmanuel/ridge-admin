"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { assetUrl } from "@/components/Logo";
import { DEFAULT_COLOR, eventType, mix, normalizeHex, onColor, textOnWhite } from "@/lib/eventTheme";

export interface EventCardData {
  slug: string;
  name: string;
  brandName?: string | null;
  color?: string | null;
  logoUrl?: string | null;
  type: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  modules: string[];
  terms: { person: string; people: string };
  tagline?: string;
  date?: string;
  time?: string;
  venue?: string;
  sheetLinked?: boolean;
  lastSyncAt?: string | null;
  total: number;
  invited?: number;
  reserved: number;
  checkedIn: number;
  contacted: number;
  capacity: number | null;
}

function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "not synced yet";
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function pct(part: number, whole: number): number {
  return whole ? Math.min(100, Math.round((part / whole) * 100)) : 0;
}

function Figure({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0">
      <p className="font-serif text-2xl leading-none tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</p>
      <p className="text-xs text-muted mt-1.5 truncate">{label}</p>
    </div>
  );
}

function Meter({ label, value, max, color, note }: { label: string; value: number; max: number; color: string; note: string }) {
  const width = max > 0 ? Math.max(value > 0 ? 3 : 0, pct(value, max)) : 0;
  return (
    <div>
      <div className="flex justify-between gap-3 text-xs text-muted mb-1.5">
        <span className="truncate">{label}</span>
        <span className="tabular-nums shrink-0">{note}</span>
      </div>
      <div className="h-2 rounded-full bg-tint border border-border overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
      </div>
    </div>
  );
}

const icon = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

/**
 * One event as a card: a band in the event's colour with its logo, then its details and numbers.
 * Used on the events page and in the wizard's live preview (`preview` turns off the link).
 */
export default function EventCard({ event: e, preview = false }: { event: EventCardData; preview?: boolean }) {
  const color = normalizeHex(e.color) ?? DEFAULT_COLOR;
  const ink = onColor(color);
  const brand = e.brandName?.trim() || e.name || "Event name";
  const initials = brand.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "E";
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), []);

  const when = [e.date, e.time].filter(Boolean).join(", ");
  const seats = e.modules.includes("invitations");
  const checkin = e.modules.includes("attendance");

  const body = (
    <>
      <div className="relative px-5 pt-5 pb-4 min-h-[8.5rem] flex flex-col justify-between" style={{ background: `linear-gradient(135deg, ${color}, ${mix(color, "#000000", 0.2)})`, color: ink }}>
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-medium opacity-90">{eventType(e.type).label}</span>
          {e.status !== "ACTIVE" && (
            <span className="text-xs font-medium rounded-full px-2.5 py-0.5 border" style={{ borderColor: ink, color: ink }}>
              {e.status === "DRAFT" ? "Draft" : "Archived"}
            </span>
          )}
        </div>
        <div className="mt-4 flex items-center bg-white rounded-lg px-3 h-12 w-fit max-w-full shadow-sm">
          {e.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assetUrl(e.logoUrl)} alt="" className="max-h-8 max-w-[10rem] object-contain" />
          ) : (
            <span className="flex items-center gap-2.5 min-w-0">
              <span className="h-7 w-7 rounded-full grid place-items-center text-xs font-bold shrink-0" style={{ background: color, color: ink }}>
                {initials}
              </span>
              <span className="text-sm font-semibold truncate" style={{ color: textOnWhite(color) }}>
                {brand}
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="p-5 flex-1 flex flex-col">
        <h3 className="font-serif text-xl leading-snug break-words">{e.name || "Your event name"}</h3>
        {e.tagline ? <p className="text-sm text-muted mt-1 break-words">{e.tagline}</p> : null}
        <div className="mt-3 space-y-1.5 text-sm text-muted">
          <p className="flex items-center gap-2">
            <svg {...icon}>
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            <span className="truncate">{when || "Date to be set"}</span>
          </p>
          <p className="flex items-center gap-2">
            <svg {...icon}>
              <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
            <span className="truncate">{e.venue || "Venue to be set"}</span>
          </p>
        </div>

        <div className={`grid gap-4 mt-5 ${seats && checkin ? "grid-cols-3" : "grid-cols-2"}`}>
          <Figure label={e.terms.people} value={e.total} />
          {seats ? <Figure label="Reserved" value={e.reserved} /> : <Figure label="Contacted" value={e.contacted} />}
          {seats && checkin ? <Figure label="Checked in" value={e.checkedIn} /> : null}
        </div>

        <div className="space-y-3 mt-5">
          <Meter label="Contacted by phone" value={e.contacted} max={e.total} color={color} note={`${pct(e.contacted, e.total)}%`} />
          {seats && <Meter label={e.capacity ? `Seats taken, ${e.reserved} of ${e.capacity}` : `Reserved of ${e.terms.people.toLowerCase()}`} value={e.reserved} max={e.capacity ?? e.total} color={color} note={`${pct(e.reserved, e.capacity ?? e.total)}%`} />}
        </div>

        <div className="mt-auto pt-5 flex items-center justify-between gap-3 text-xs text-muted">
          <span className="truncate">{preview ? "Live sheet and numbers appear here" : e.sheetLinked ? `Live sheet, synced ${now ? ago(e.lastSyncAt, now) : ""}` : "No live sheet linked"}</span>
          {!preview && <span className="font-medium text-fg group-hover:underline shrink-0">Open</span>}
        </div>
      </div>
    </>
  );

  const shell = "group flex flex-col rounded-2xl border border-border bg-cardbg overflow-hidden text-left";
  if (preview) return <div className={shell}>{body}</div>;
  return (
    <Link href={`/${e.slug}`} className={`${shell} transition-shadow hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${e.status === "ARCHIVED" ? "opacity-75" : ""}`}>
      {body}
    </Link>
  );
}
