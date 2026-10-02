"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import { SEAT_STATUS_META, TABLES_PER_ROW, type SeatStatus } from "@/lib/seating";

interface SeatData {
  id: string;
  seatNumber: number;
  label: string;
  status: SeatStatus;
  mine: boolean;
}
interface TableData {
  id: string;
  label: string;
  seats: SeatData[];
}
interface Loaded {
  guest: { firstName: string };
  current: { mode: "IN_PERSON" | "ONLINE" | null; seatLabel: string | null };
  tables: TableData[];
}

const RED = "#EB3C34";
const goldButton =
  "text-sm px-6 py-3 rounded-full bg-gold text-black font-semibold uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-60";
const ghostButton = "text-sm px-6 py-3 rounded-full border border-border text-fg hover:border-gold transition-colors disabled:opacity-60";

function positions(n: number, radius: number, cx: number, cy: number) {
  return Array.from({ length: n }, (_, i) => {
    const a = ((360 / n) * i - 90) * (Math.PI / 180);
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  });
}

function RoundTable({ table, selectedId, onPick }: { table: TableData; selectedId: string | null; onPick: (s: SeatData) => void }) {
  const size = 130;
  const c = size / 2;
  const pos = positions(table.seats.length, 40, c, c);
  const open = table.seats.filter((s) => s.status === "OPEN").length;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {table.seats.map((seat, i) => {
          const meta = SEAT_STATUS_META[seat.status];
          const selected = seat.id === selectedId;
          const pickable = seat.status === "OPEN";
          // "Taken" is a red status, so the person's own seat and a seat they are
          // about to book are shown as white discs with a coloured ring instead.
          const highlighted = seat.mine || selected;
          const fill = highlighted ? "#FEFEFE" : meta.fill;
          const stroke = seat.mine ? RED : selected ? SEAT_STATUS_META.OPEN.stroke : meta.stroke;
          return (
            <g
              key={seat.id}
              onClick={() => pickable && onPick(seat)}
              className={pickable ? "cursor-pointer" : "cursor-not-allowed"}
              role={pickable ? "button" : undefined}
              aria-label={`Seat ${seat.label}, ${seat.mine ? "your seat" : meta.label}`}
            >
              <title>{`${seat.label}: ${seat.mine ? "Your seat" : meta.label}`}</title>
              <circle cx={pos[i].x} cy={pos[i].y} r={highlighted ? 11 : 9.5} fill={fill} stroke={stroke} strokeWidth={highlighted ? 3 : 1.5} />
              <text
                x={pos[i].x}
                y={pos[i].y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={highlighted ? "#000" : meta.stroke}
                fontSize="7"
                fontFamily="Arial, sans-serif"
                fontWeight={700}
                className="pointer-events-none select-none"
              >
                {seat.seatNumber}
              </text>
            </g>
          );
        })}
        <circle cx={c} cy={c} r={24} fill="#0A0A0A" stroke="#404040" strokeWidth={1.5} />
        <text x={c} y={c} textAnchor="middle" dominantBaseline="central" fill="#FEFEFE" fontSize="13" fontFamily="Georgia, serif" fontWeight={600}>
          {table.label}
        </text>
      </svg>
      <p className="text-xs text-muted -mt-1">{open > 0 ? `${open} open` : "Full"}</p>
    </div>
  );
}

function SeatPicker() {
  const token = useSearchParams().get("t") || "";
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SeatData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmOnline, setConfirmOnline] = useState(false);
  const [done, setDone] = useState<{ kind: "seat" | "online"; label?: string; emailSent: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError("This link is missing its access code. Please use the link in your email, or contact the RIDGE team.");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/public/seats?t=${encodeURIComponent(token)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "We couldn't open the seat page. Please try again.");
      } else {
        setData(json);
        setError(null);
        // Drop the highlighted seat if someone else has taken it meanwhile.
        setSelected((prev) => {
          if (!prev) return prev;
          const now = (json as Loaded).tables.flatMap((t) => t.seats).find((s) => s.id === prev.id);
          return now && now.status === "OPEN" ? prev : null;
        });
      }
    } catch {
      setError("We couldn't reach the server. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 20_000);
    return () => clearInterval(t);
  }, [load]);

  async function post(path: string, body: object) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, ...body }) });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, json };
    } catch {
      return { ok: false, json: { error: "We couldn't reach the server. Please try again." } };
    } finally {
      setBusy(false);
    }
  }

  async function confirmSeat() {
    if (!selected) return;
    const { ok, json } = await post("/api/public/seats/select", { seatId: selected.id });
    if (ok) {
      setDone({ kind: "seat", label: json.seatLabel, emailSent: json.emailSent !== false });
      setSelected(null);
      load();
    } else {
      setMessage({ text: json.error || "Couldn't book that seat.", ok: false });
      setSelected(null);
      load();
    }
  }

  async function chooseOnline() {
    const { ok, json } = await post("/api/public/seats/online", {});
    setConfirmOnline(false);
    if (ok) {
      setDone({ kind: "online", emailSent: json.emailSent !== false });
      load();
    } else {
      setMessage({ text: json.error || "Couldn't save your choice.", ok: false });
    }
  }

  const rows = useMemo(() => {
    const out: TableData[][] = [];
    if (!data) return out;
    for (let i = 0; i < data.tables.length; i += TABLES_PER_ROW) out.push(data.tables.slice(i, i + TABLES_PER_ROW));
    return out;
  }, [data]);

  const current = data?.current;

  return (
    <div className="min-h-screen pb-32">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-5 py-5 flex items-center justify-between gap-4">
          <Logo className="h-10 w-auto" />
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 pt-10">
        {loading && <p className="text-muted">Loading…</p>}

        {!loading && error && (
          <div className="max-w-xl mx-auto border border-border rounded-2xl p-8 text-center">
            <h1 className="font-serif text-2xl mb-3">We couldn&apos;t open your seat page</h1>
            <p className="text-muted text-sm leading-relaxed">{error}</p>
          </div>
        )}

        {!loading && !error && data && done && (
          <div className="max-w-xl mx-auto border border-border rounded-2xl p-8 text-center mb-10">
            <div className="mx-auto mb-5 w-14 h-14 rounded-full bg-gold text-black flex items-center justify-center text-2xl">✓</div>
            <h1 className="font-serif text-2xl mb-3">{done.kind === "seat" ? `Seat ${done.label} is yours` : "You're attending online"}</h1>
            <p className="text-muted text-sm leading-relaxed">
              {done.emailSent
                ? "A confirmation email is on its way to you."
                : "Your choice is saved. We couldn't send the confirmation email just now, but the RIDGE team can resend it."}
            </p>
            <button onClick={() => setDone(null)} className={`${ghostButton} mt-6`}>
              {done.kind === "seat" ? "Change my seat" : "Choose a seat instead"}
            </button>
          </div>
        )}

        {!loading && !error && data && !done && (
          <>
            <div className="text-center max-w-2xl mx-auto mb-8">
              <p className="text-xs uppercase tracking-[0.2em] text-muted mb-3">Day 7 · Graduation and Investor&apos;s Dinner</p>
              <h1 className="font-serif text-3xl sm:text-4xl mb-3">Hi {data.guest.firstName}, choose your seat</h1>
              <p className="text-muted text-sm leading-relaxed">
                Tap an open seat on the map, then confirm. You will receive an email with your seat details. You can change your seat later if you need to.
              </p>
            </div>

            {current?.seatLabel && (
              <p className="text-center text-sm mb-6 border border-gold/50 rounded-full px-5 py-2 w-fit mx-auto">
                Your current seat: <span className="font-semibold text-goldlight">{current.seatLabel}</span>
              </p>
            )}
            {current?.mode === "ONLINE" && (
              <p className="text-center text-sm mb-6 border border-gold/50 rounded-full px-5 py-2 w-fit mx-auto">You are currently set to attend online.</p>
            )}
            {message && <p className={`text-center text-sm mb-6 ${message.ok ? "text-goldlight" : "text-red-400"}`}>{message.text}</p>}

            <div className="border border-border rounded-2xl p-5 mb-8 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-semibold">Not able to come to the venue?</p>
                <p className="text-muted text-sm">You can join Day 7 online instead.</p>
              </div>
              {!confirmOnline ? (
                <button onClick={() => setConfirmOnline(true)} disabled={busy || current?.mode === "ONLINE"} className={ghostButton}>
                  {current?.mode === "ONLINE" ? "Attending online" : "Attend online"}
                </button>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-muted">{current?.seatLabel ? `This will release seat ${current.seatLabel}.` : "Confirm attending online?"}</span>
                  <button onClick={() => setConfirmOnline(false)} disabled={busy} className={ghostButton}>
                    Cancel
                  </button>
                  <button onClick={chooseOnline} disabled={busy} className={goldButton}>
                    {busy ? "Saving…" : "Yes, attend online"}
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted mb-4">
              {[
                ["Open", SEAT_STATUS_META.OPEN.stroke, false],
                ["Taken", SEAT_STATUS_META.TAKEN.stroke, false],
                ["Not available", SEAT_STATUS_META.BLOCKED.stroke, false],
                ["Your seat", RED, true],
                ["Selected", SEAT_STATUS_META.OPEN.stroke, true],
              ].map(([label, color, ring]) => (
                <span key={label as string} className="inline-flex items-center gap-2">
                  <span
                    className="inline-block w-3.5 h-3.5 rounded-full"
                    style={ring ? { background: "#FEFEFE", border: `3px solid ${color}` } : { background: color as string }}
                  />
                  {label}
                </span>
              ))}
            </div>

            <div className="rounded-2xl p-4 sm:p-6 overflow-x-auto" style={{ background: "#000", border: "1px solid #404040" }}>
              <div style={{ minWidth: 6 * 132 }}>
                <div className="text-center text-[11px] uppercase tracking-[0.3em] mb-5 py-2 rounded-lg" style={{ color: "#ADADAD", border: "1px solid #404040" }}>
                  Stage
                </div>
                <div className="space-y-4">
                  {rows.map((row, i) => (
                    <div key={i} className="grid" style={{ gridTemplateColumns: `repeat(${TABLES_PER_ROW}, 1fr)` }}>
                      {row.map((t) => (
                        <RoundTable key={t.id} table={t} selectedId={selected?.id ?? null} onPick={(s) => { setSelected(s); setMessage(null); }} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {selected && !done && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t border-border bg-pagebg/95 backdrop-blur">
          <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm">
              Seat <span className="font-semibold text-goldlight">{selected.label}</span> selected
              {current?.seatLabel && current.seatLabel !== selected.label ? <span className="text-muted"> (replaces {current.seatLabel})</span> : null}
            </p>
            <div className="flex items-center gap-3">
              <button onClick={() => setSelected(null)} disabled={busy} className={ghostButton}>
                Cancel
              </button>
              <button onClick={confirmSeat} disabled={busy} className={goldButton}>
                {busy ? "Booking…" : "Confirm seat"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SelectSeatPage() {
  return (
    <Suspense fallback={null}>
      <SeatPicker />
    </Suspense>
  );
}
