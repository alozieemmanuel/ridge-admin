"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import SeatsSubNav from "@/components/SeatsSubNav";
import { SEAT_STATUS_META, type SeatStatus, TABLES_PER_ROW } from "@/lib/seating";

interface SeatData {
  id: string;
  seatNumber: number;
  label: string;
  status: SeatStatus;
  released: boolean;
  registration: { id: string; fullName: string; email: string } | null;
}

interface TableData {
  id: string;
  label: string;
  order: number;
  seats: SeatData[];
}

function seatPositions(n: number, radius: number, cx: number, cy: number) {
  return Array.from({ length: n }, (_, i) => {
    const angle = (360 / n) * i - 90;
    const rad = (angle * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  });
}

function seatTooltip(seat: SeatData): string {
  const statusLabel = SEAT_STATUS_META[seat.status].label;
  const shown = seat.released ? "visible to guests" : "hidden from guests";
  if (seat.registration) {
    return `${seat.label} — ${statusLabel} (${seat.registration.fullName}) · ${shown}`;
  }
  return `${seat.label} — ${statusLabel} · ${shown}`;
}

const UNVEIL_RING = "#C9972E";

function RoundTable({
  table,
  onSeatClick,
}: {
  table: TableData;
  onSeatClick: (seat: SeatData) => void;
}) {
  const size = 150;
  const center = size / 2;
  const tableRadius = 28;
  const seatRadius = 9;
  const orbitRadius = 46;
  const positions = seatPositions(table.seats.length, orbitRadius, center, center);

  const takenCount = table.seats.filter((s) => s.status === "TAKEN").length;
  const openCount = table.seats.filter((s) => s.status === "OPEN").length;
  const shownCount = table.seats.filter((s) => s.released).length;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {table.seats.map((seat, i) => {
          const pos = positions[i];
          const meta = SEAT_STATUS_META[seat.status];
          return (
            <g key={seat.id} onClick={() => onSeatClick(seat)} className="cursor-pointer">
              <title>{seatTooltip(seat)}</title>
              {seat.released && (
                <circle cx={pos.x} cy={pos.y} r={seatRadius + 3.5} fill="none" stroke={UNVEIL_RING} strokeWidth={1.5} />
              )}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={seatRadius}
                fill={meta.fill}
                stroke={meta.stroke}
                strokeWidth={1.5}
              />
              <text
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={meta.stroke}
                fontSize="6"
                fontFamily="Arial, sans-serif"
                fontWeight={600}
                className="pointer-events-none select-none"
              >
                {seat.seatNumber}
              </text>
            </g>
          );
        })}
        <circle
          cx={center}
          cy={center}
          r={tableRadius}
          fill="#15110B"
          stroke="#C9972E"
          strokeWidth={1.5}
          strokeOpacity={0.5}
        />
        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#F1C866"
          fontSize="14"
          fontFamily="Georgia, serif"
          fontWeight={600}
        >
          {table.label}
        </text>
      </svg>
      <p className="text-xs text-muted mt-1">
        {takenCount > 0 && <span className="text-red-400">{takenCount} taken</span>}
        {takenCount > 0 && openCount > 0 && " · "}
        {openCount > 0 && <span className="text-emerald-400">{openCount} open</span>}
        {openCount === 0 && takenCount === 0 && <span>Blocked</span>}
        {shownCount > 0 && <span className="text-goldlight"> · {shownCount} unveiled</span>}
      </p>
    </div>
  );
}

export default function SeatsPage() {
  const [tables, setTables] = useState<TableData[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSeatId, setSavingSeatId] = useState<string | null>(null);
  // "status": clicking a seat cycles its status. "unveil": clicking a seat shows or hides it for guests.
  const [mode, setMode] = useState<"status" | "unveil">("status");
  const [unveilCount, setUnveilCount] = useState("50");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/seats");
    if (res.ok) {
      const data = await res.json();
      setTables(data.tables);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSeatClick(seat: SeatData) {
    if (mode === "unveil") {
      if (seat.registration && seat.released) {
        setNotice({ text: "That seat is booked, so it stays visible to its holder.", ok: false });
        return;
      }
      const released = !seat.released;
      setTables((prev) =>
        prev.map((t) => ({ ...t, seats: t.seats.map((x) => (x.id !== seat.id ? x : { ...x, released })) }))
      );
      const res = await fetch(`/api/admin/seats/${seat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ released }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNotice({ text: data.error || "Couldn't update that seat.", ok: false });
        load();
      }
      return;
    }

    const order: SeatStatus[] = ["OPEN", "RESERVED", "TAKEN", "BLOCKED"];
    const nextStatus = order[(order.indexOf(seat.status) + 1) % order.length];

    setSavingSeatId(seat.id);
    setTables((prev) =>
      prev.map((t) => ({
        ...t,
        seats: t.seats.map((s) => (s.id !== seat.id ? s : { ...s, status: nextStatus })),
      }))
    );

    const res = await fetch(`/api/admin/seats/${seat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    setSavingSeatId(null);

    if (!res.ok) {
      load();
    }
  }

  async function runBulk(action: "unveil_next" | "unveil_all" | "hide_open") {
    const count = parseInt(unveilCount, 10);
    if (action === "unveil_next" && (!Number.isFinite(count) || count < 1)) {
      setNotice({ text: "Enter how many seats to unveil.", ok: false });
      return;
    }
    if (action === "unveil_all" && !window.confirm("Unveil every open seat to participants?")) return;
    if (action === "hide_open" && !window.confirm("Hide all open seats from participants? Booked seats stay visible.")) return;

    setBulkBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/seats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, count: action === "unveil_next" ? count : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ text: data.error || "Couldn't update the seats.", ok: false });
      } else if (action === "hide_open") {
        setNotice({ text: `${data.affected} seats hidden.`, ok: true });
      } else if (data.affected === 0) {
        setNotice({ text: "There are no more open seats to unveil.", ok: false });
      } else {
        setNotice({
          text:
            action === "unveil_next" && data.affected < count
              ? `Only ${data.affected} open seats were left, and all are now unveiled.`
              : `${data.affected} seats unveiled.`,
          ok: true,
        });
      }
      await load();
    } finally {
      setBulkBusy(false);
    }
  }

  const totals = tables.length
    ? tables.reduce(
        (acc, t) => {
          for (const s of t.seats) {
            acc.total++;
            if (s.released) acc.unveiled++;
            if (s.released && s.status === "OPEN") acc.visibleOpen++;
            if (s.status === "OPEN") acc.open++;
            else if (s.status === "RESERVED") acc.reserved++;
            else if (s.status === "TAKEN") acc.taken++;
            else acc.blocked++;
          }
          return acc;
        },
        { total: 0, open: 0, reserved: 0, taken: 0, blocked: 0, unveiled: 0, visibleOpen: 0 }
      )
    : null;

  const rows: TableData[][] = [];
  for (let i = 0; i < tables.length; i += TABLES_PER_ROW) {
    rows.push(tables.slice(i, i + TABLES_PER_ROW));
  }

  return (
    <AdminShell active="/admin/seats">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">Day 7 Seating</h2>
        <p className="text-muted text-sm mt-1">
          All {totals?.total ?? 300} seats are shown here. Participants only see the seats you unveil. A gold
          ring marks an unveiled seat. Hover a seat to see its status and who it&apos;s assigned to.
          {savingSeatId && <span className="text-goldlight ml-2">Saving…</span>}
        </p>
      </div>

      <SeatsSubNav active="/admin/seats" />

      {loading && <p className="text-muted">Loading…</p>}

      {!loading && tables.length === 0 && (
        <p className="text-muted">
          No tables found. Run <code className="text-goldlight">npm run seed</code> to generate the venue
          layout.
        </p>
      )}

      {!loading && tables.length > 0 && (
        <>
          <div className="border border-border rounded-xl p-5 mb-6">
            <h3 className="font-serif text-lg mb-1">Unveil seats to participants</h3>
            <p className="text-sm text-muted mb-4">
              Fully paid participants can only pick unveiled seats. Release a batch now, then unveil more once
              those are taken.
            </p>

            {totals && (
              <div className="flex flex-wrap gap-3 mb-5">
                {[
                  ["Unveiled", totals.unveiled, "text-goldlight"],
                  ["Still open to guests", totals.visibleOpen, "text-emerald-300"],
                  ["Taken", totals.taken, "text-red-300"],
                  ["Hidden", totals.total - totals.unveiled, "text-muted"],
                ].map(([label, value, tone]) => (
                  <div key={label as string} className="border border-border rounded-lg px-4 py-2.5 min-w-[120px]">
                    <p className="text-[11px] uppercase tracking-wider text-muted mb-1">{label}</p>
                    <p className={`text-xl font-serif ${tone}`}>{value}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <input
                type="number"
                min={1}
                max={300}
                value={unveilCount}
                onChange={(e) => setUnveilCount(e.target.value)}
                className="w-24 bg-inputbg border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-gold"
                aria-label="Number of seats to unveil"
              />
              <button
                onClick={() => runBulk("unveil_next")}
                disabled={bulkBusy}
                className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest disabled:opacity-60"
              >
                {bulkBusy ? "Working…" : `Unveil next ${parseInt(unveilCount, 10) > 0 ? unveilCount : ""} seats`}
              </button>
              <button
                onClick={() => runBulk("unveil_all")}
                disabled={bulkBusy}
                className="text-sm px-4 py-2.5 rounded-full border border-border text-muted hover:text-fg disabled:opacity-60"
              >
                Unveil all
              </button>
              <button
                onClick={() => runBulk("hide_open")}
                disabled={bulkBusy}
                className="text-sm px-4 py-2.5 rounded-full border border-border text-muted hover:text-fg disabled:opacity-60"
              >
                Hide open seats
              </button>
            </div>
            <p className="text-xs text-muted mt-3">
              &quot;Unveil next&quot; goes in table order (A1, A2 … then B1 …) and only counts open seats.
            </p>
            {notice && <p className={`text-sm mt-3 ${notice.ok ? "text-goldlight" : "text-red-400"}`}>{notice.text}</p>}
          </div>

          <div className="flex gap-2 mb-5">
            {(
              [
                ["status", "Click to change status"],
                ["unveil", "Click to unveil or hide a seat"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`text-sm px-4 py-2 rounded-full border transition-colors whitespace-nowrap ${
                  mode === m ? "border-gold text-goldlight bg-gold/10" : "border-border text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "status" && (
            <p className="text-xs text-muted -mt-2 mb-5">
              Clicking a seat cycles its status (Open → Reserved → Taken → Blocked). Setting a seat back to Open
              or Blocked clears any assignment.
            </p>
          )}

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm mb-8">
            {(Object.keys(SEAT_STATUS_META) as SeatStatus[]).map((status) => (
              <span key={status} className="inline-flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full inline-block border-2"
                  style={{
                    background: SEAT_STATUS_META[status].fill,
                    borderColor: SEAT_STATUS_META[status].stroke,
                  }}
                />
                <span className="text-muted">{SEAT_STATUS_META[status].label}</span>
              </span>
            ))}
            <span className="inline-flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full inline-block border-2" style={{ borderColor: UNVEIL_RING }} />
              <span className="text-muted">Unveiled to guests</span>
            </span>
            {totals && (
              <span className="text-muted ml-auto">
                {totals.open} open · {totals.reserved} reserved · {totals.taken} taken · {totals.blocked}{" "}
                blocked · {totals.total} total
              </span>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-cardbg p-8 overflow-x-auto">
            <div className="min-w-[900px]">
              <div className="mx-auto mb-10 max-w-2xl h-14 rounded-full bg-gradient-to-r from-[#3a1f12] via-[#6b3420] to-[#3a1f12] flex items-center justify-center border border-gold/30">
                <span className="text-goldlight text-xs tracking-[0.3em] uppercase font-semibold">
                  Stage
                </span>
              </div>

              <div className="space-y-8">
                {rows.map((row, i) => (
                  <div key={i} className="flex justify-center gap-6">
                    {row.map((table) => (
                      <RoundTable key={table.id} table={table} onSeatClick={handleSeatClick} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="text-xs text-muted mt-4">
            Attendees joining online for Day 7 won&apos;t need a physical seat — that path is handled
            separately in the registration flow rather than shown on this floor plan.
          </p>
        </>
      )}
    </AdminShell>
  );
}
