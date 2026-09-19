"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import AdminShell from "@/components/AdminShell";
import SeatsSubNav from "@/components/SeatsSubNav";

interface SeatData {
  id: string;
  seatNumber: number;
  label: string;
  status: string;
  registration: { id: string; fullName: string; email: string; checkedInAt: string | null } | null;
}

interface TableData {
  id: string;
  label: string;
  order: number;
  seats: SeatData[];
}

interface Attendee {
  registrationId: string;
  fullName: string;
  email: string;
  seatLabel: string;
  checkedIn: boolean;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="border border-border rounded-xl px-5 py-4 flex-1 min-w-[140px]">
      <p className="text-xs uppercase tracking-wider text-muted mb-1.5">{label}</p>
      <p className={`text-2xl font-serif ${accent}`}>{value}</p>
    </div>
  );
}

export default function AttendancePage() {
  const [tables, setTables] = useState<TableData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

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

  const attendees: Attendee[] = useMemo(() => {
    const list: Attendee[] = [];
    for (const table of tables) {
      for (const seat of table.seats) {
        if (seat.registration) {
          list.push({
            registrationId: seat.registration.id,
            fullName: seat.registration.fullName,
            email: seat.registration.email,
            seatLabel: seat.label,
            checkedIn: !!seat.registration.checkedInAt,
          });
        }
      }
    }
    return list.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [tables]);

  const checkedInCount = attendees.filter((a) => a.checkedIn).length;

  const visible = search
    ? attendees.filter(
        (a) =>
          a.fullName.toLowerCase().includes(search.toLowerCase()) ||
          a.email.toLowerCase().includes(search.toLowerCase()) ||
          a.seatLabel.toLowerCase().includes(search.toLowerCase())
      )
    : attendees;

  async function toggleCheckIn(a: Attendee) {
    setSavingId(a.registrationId);
    const res = await fetch(`/api/admin/registrations/${a.registrationId}/checkin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkedIn: !a.checkedIn }),
    });
    setSavingId(null);
    if (res.ok) load();
  }

  return (
    <AdminShell active="/admin/seats">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">Seats</h2>
        <p className="text-muted text-sm mt-1">Track who has arrived on Day 7.</p>
      </div>

      <SeatsSubNav active="/admin/seats/attendance" />

      <div className="flex flex-wrap gap-4 mb-6">
        <StatCard label="Checked in" value={String(checkedInCount)} accent="text-emerald-300" />
        <StatCard label="Seats booked" value={String(attendees.length)} accent="text-goldlight" />
        <StatCard label="Not yet in" value={String(attendees.length - checkedInCount)} accent="text-muted" />
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, email, or seat"
        className="w-full max-w-md bg-cardbg border border-border rounded-lg px-4 py-2.5 text-sm mb-6 focus:outline-none focus:border-gold"
      />

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="table-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                <th className="sticky left-0 z-10 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Name</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Email</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Seat</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Status</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted">
                    No seated attendees found.
                  </td>
                </tr>
              )}
              {!loading &&
                visible.map((a) => (
                  <tr key={a.registrationId} className="border-b border-border/50 last:border-b-0">
                    <td className="sticky left-0 z-10 bg-pagebg px-5 py-4 whitespace-nowrap font-medium">
                      {a.fullName}
                    </td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">{a.email}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className="px-2.5 py-1 rounded-full border border-gold/40 text-goldlight text-xs font-semibold">
                        {a.seatLabel}
                      </span>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {a.checkedIn ? (
                        <span className="text-emerald-400 text-xs">Checked in</span>
                      ) : (
                        <span className="text-muted text-xs">Not yet</span>
                      )}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <button
                        onClick={() => toggleCheckIn(a)}
                        disabled={savingId === a.registrationId}
                        className={`text-xs px-3.5 py-2 rounded-full border whitespace-nowrap disabled:opacity-50 ${
                          a.checkedIn
                            ? "border-border text-muted hover:text-fg"
                            : "border-gold/40 text-goldlight hover:bg-gold/10"
                        }`}
                      >
                        {savingId === a.registrationId ? "Saving…" : a.checkedIn ? "Undo check-in" : "Check in"}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
