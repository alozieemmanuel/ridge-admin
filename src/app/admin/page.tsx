"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { PageHeader, StatCard, formatDateTime, ghostButton, primaryButton } from "@/components/ui";
import { FOLLOW_UP_STATUSES } from "@/lib/followUp";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { cacheGet, cacheSet } from "@/lib/clientCache";

interface Overview {
  total: number;
  invited: number;
  notInvited: number;
  awaitingReply: number;
  reserved: number;
  checkedIn: number;
  capacity: number | null;
  seatsLeft: number | null;
  contacted: number;
  followUp: Record<string, number>;
  withFeedback: number;
  recentReservations: { id: string; fullName: string; reservedAt: string }[];
  reservationsPerDay: { date: string; count: number }[];
}

const URL = "/api/admin/overview";

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "0%";
}

/** A horizontal bar: `value` out of `max`. */
function Bar({ value, max, color = "bg-gold" }: { value: number; max: number; color?: string }) {
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2.5 rounded-full bg-tint border border-border overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(() => cacheGet<Overview>(URL) ?? null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(URL, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const json: Overview = await res.json();
      cacheSet(URL, json);
      setData(json);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(load, 30_000);

  const d = data;
  const funnelMax = d?.total ?? 0;
  const dayMax = d ? Math.max(1, ...d.reservationsPerDay.map((x) => x.count)) : 1;

  return (
    <AdminShell active="/admin">
      <PageHeader
        title="Overview"
        subtitle="Where the Investor Breakfast Hangout stands right now."
        actions={
          <>
            <Link href="/admin/registrations" className={ghostButton}>
              Guest list
            </Link>
            <Link href="/admin/attendance" className={primaryButton}>
              Attendance
            </Link>
          </>
        }
      />

      {error && !d && <p className="text-sm text-red-400 mb-4">Couldn&apos;t load the numbers. Check your connection and try again.</p>}
      {!d && !error && <p className="text-muted">Loading…</p>}

      {d && (
        <>
          {d.total === 0 && (
            <div className="border border-gold/50 bg-gold/10 rounded-xl p-5 mb-6 text-sm">
              <p className="font-semibold mb-1">Start by loading your guest list</p>
              <p className="text-muted">
                Go to <Link href="/admin/registrations" className="text-goldlight underline">Contacts</Link> and use <em>Connect live sheet</em> or <em>Import CSV</em> to load your
                list. These numbers fill in as soon as it is loaded.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <StatCard href="/admin/registrations" label="Total guests" value={d.total.toLocaleString()} hint="On the guest list" />
            <StatCard
              href="/admin/registrations?seat=RESERVED"
              label="Seats reserved"
              value={d.capacity ? `${d.reserved} / ${d.capacity}` : d.reserved.toLocaleString()}
              hint={d.capacity ? `${d.seatsLeft} seat${d.seatsLeft === 1 ? "" : "s"} left` : "No seat limit set"}
              tone="text-goldlight"
            />
            <StatCard href="/admin/registrations?seat=INVITED" label="Invited" value={d.invited.toLocaleString()} hint={`${d.notInvited.toLocaleString()} not invited yet`} />
            <StatCard href="/admin/attendance?filter=IN" label="Checked in" value={d.checkedIn.toLocaleString()} hint={d.reserved ? `${pct(d.checkedIn, d.reserved)} of reserved seats` : "Nobody has reserved yet"} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard href="/admin/registrations?seat=AWAITING" label="Awaiting a reply" value={d.awaitingReply.toLocaleString()} hint="Invited, haven't reserved" tone={d.awaitingReply ? "text-amber-300" : "text-fg"} />
            <StatCard href="/admin/registrations?followUp=CONTACTED" label="Contacted by phone" value={d.contacted.toLocaleString()} hint={`${pct(d.contacted, d.total)} of the list`} />
            <StatCard href="/admin/registrations?followUp=INTERESTED" label="Interested" value={(d.followUp.INTERESTED ?? 0).toLocaleString()} hint="Said yes on the call" tone="text-emerald-400" />
            <StatCard href="/admin/registrations?followUp=NOT_INTERESTED" label="Not interested" value={(d.followUp.NOT_INTERESTED ?? 0).toLocaleString()} hint="Said no on the call" tone={d.followUp.NOT_INTERESTED ? "text-red-400" : "text-fg"} />
          </div>

          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            <section className="border border-border rounded-xl p-6 bg-cardbg">
              <h3 className="font-serif text-xl mb-1">From list to seat</h3>
              <p className="text-xs text-muted mb-5">How many guests have reached each step.</p>
              <div className="space-y-4">
                {[
                  { label: "On the guest list", value: d.total, href: "/admin/registrations" },
                  { label: "Invited", value: d.invited, href: "/admin/registrations?seat=INVITED" },
                  { label: "Reserved a seat", value: d.reserved, href: "/admin/registrations?seat=RESERVED" },
                  { label: "Checked in", value: d.checkedIn, href: "/admin/attendance?filter=IN" },
                ].map((row) => (
                  <Link key={row.label} href={row.href} className="block rounded-lg -mx-2 px-2 py-1 hover:bg-gold/10 transition-colors">
                    <div className="flex justify-between text-sm mb-1.5">
                      <span>{row.label}</span>
                      <span className="text-muted">
                        {row.value.toLocaleString()} <span className="opacity-70">({pct(row.value, funnelMax)})</span>
                      </span>
                    </div>
                    <Bar value={row.value} max={funnelMax} />
                  </Link>
                ))}
              </div>
            </section>

            <section className="border border-border rounded-xl p-6 bg-cardbg">
              <h3 className="font-serif text-xl mb-1">Phone follow-up</h3>
              <p className="text-xs text-muted mb-5">Where the calls have got to.</p>
              <div className="space-y-3.5">
                {FOLLOW_UP_STATUSES.map((s) => (
                  <Link key={s.value} href={`/admin/registrations?followUp=${s.value}`} className="block rounded-lg -mx-2 px-2 py-1 hover:bg-gold/10 transition-colors">
                    <div className="flex justify-between text-sm mb-1.5">
                      <span>{s.label}</span>
                      <span className="text-muted">{(d.followUp[s.value] ?? 0).toLocaleString()}</span>
                    </div>
                    <Bar value={d.followUp[s.value] ?? 0} max={d.total} color={s.value === "NOT_INTERESTED" ? "bg-red-400" : s.value === "NOT_CONTACTED" ? "bg-border" : "bg-gold"} />
                  </Link>
                ))}
              </div>
              <p className="text-xs text-muted mt-5">
                Call feedback is logged for {d.withFeedback.toLocaleString()} guest{d.withFeedback === 1 ? "" : "s"}.
              </p>
            </section>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <section className="border border-border rounded-xl p-6 bg-cardbg">
              <h3 className="font-serif text-xl mb-1">Reservations, last 14 days</h3>
              <p className="text-xs text-muted mb-5">Seats reserved each day.</p>
              <div className="flex items-end gap-1.5 h-36" role="img" aria-label="Reservations per day for the last 14 days">
                {d.reservationsPerDay.map((day) => (
                  <div key={day.date} className="flex-1 flex flex-col items-center justify-end h-full" title={`${day.date}: ${day.count}`}>
                    <span className="text-[10px] text-muted mb-1">{day.count || ""}</span>
                    <div className="w-full rounded-t bg-gold" style={{ height: `${day.count ? Math.max(4, (day.count / dayMax) * 100) : 2}%`, opacity: day.count ? 1 : 0.35 }} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-muted mt-2">
                <span>{d.reservationsPerDay[0]?.date.slice(5)}</span>
                <span>{d.reservationsPerDay[d.reservationsPerDay.length - 1]?.date.slice(5)}</span>
              </div>
            </section>

            <section className="border border-border rounded-xl p-6 bg-cardbg">
              <h3 className="font-serif text-xl mb-1">Latest reservations</h3>
              <p className="text-xs text-muted mb-4">The last guests to reserve a seat.</p>
              {d.recentReservations.length === 0 ? (
                <p className="text-sm text-muted">Nobody has reserved yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {d.recentReservations.map((r) => (
                    <li key={r.id}>
                      <Link href={`/admin/registrations/${r.id}`} className="py-2.5 flex items-center justify-between gap-3 text-sm hover:text-goldlight">
                        <span className="font-medium truncate">{r.fullName}</span>
                        <span className="text-muted text-xs whitespace-nowrap">{formatDateTime(r.reservedAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </AdminShell>
  );
}
