"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { SEAT_STATUS_META, type SeatStatus, TABLES_PER_ROW } from "@/lib/seating";

interface SeatData {
  id: string;
  seatNumber: number;
  label: string;
  status: SeatStatus;
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
  if (seat.registration) {
    return `${seat.label} — ${statusLabel} (${seat.registration.fullName})`;
  }
  return `${seat.label} — ${statusLabel}`;
}

function RoundTable({
  table,
  onSeatClick,
}: {
  table: TableData;
  onSeatClick: (seatId: string, currentStatus: SeatStatus) => void;
}) {
  const size = 150;
  const center = size / 2;
  const tableRadius = 28;
  const seatRadius = 9;
  const orbitRadius = 46;
  const positions = seatPositions(table.seats.length, orbitRadius, center, center);

  const takenCount = table.seats.filter((s) => s.status === "TAKEN").length;
  const openCount = table.seats.filter((s) => s.status === "OPEN").length;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {table.seats.map((seat, i) => {
          const pos = positions[i];
          const meta = SEAT_STATUS_META[seat.status];
          return (
            <g key={seat.id} onClick={() => onSeatClick(seat.id, seat.status)} className="cursor-pointer">
              <title>{seatTooltip(seat)}</title>
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
      </p>
    </div>
  );
}

export default function SeatsPage() {
  const [tables, setTables] = useState<TableData[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSeatId, setSavingSeatId] = useState<string | null>(null);

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

  async function handleSeatClick(seatId: string, currentStatus: SeatStatus) {
    const order: SeatStatus[] = ["OPEN", "RESERVED", "TAKEN", "BLOCKED"];
    const nextStatus = order[(order.indexOf(currentStatus) + 1) % order.length];

    setSavingSeatId(seatId);
    setTables((prev) =>
      prev.map((t) => ({
        ...t,
        seats: t.seats.map((s) => (s.id !== seatId ? s : { ...s, status: nextStatus })),
      }))
    );

    const res = await fetch(`/api/admin/seats/${seatId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    setSavingSeatId(null);

    if (!res.ok) {
      load();
    }
  }

  const totals = tables.length
    ? tables.reduce(
        (acc, t) => {
          for (const s of t.seats) {
            acc.total++;
            if (s.status === "OPEN") acc.open++;
            else if (s.status === "RESERVED") acc.reserved++;
            else if (s.status === "TAKEN") acc.taken++;
            else acc.blocked++;
          }
          return acc;
        },
        { total: 0, open: 0, reserved: 0, taken: 0, blocked: 0 }
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
          Hover a seat to see its status and who it&apos;s assigned to. Click a seat to manually cycle its
          status (Open → Reserved → Taken → Blocked). Setting a seat back to Open or Blocked clears any
          assignment.
          {savingSeatId && <span className="text-goldlight ml-2">Saving…</span>}
        </p>
      </div>

      {loading && <p className="text-muted">Loading…</p>}

      {!loading && tables.length === 0 && (
        <p className="text-muted">
          No tables found. Run <code className="text-goldlight">npm run seed</code> to generate the venue
          layout.
        </p>
      )}

      {!loading && tables.length > 0 && (
        <>
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
