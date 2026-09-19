"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import AdminShell from "@/components/AdminShell";
import SeatsSubNav from "@/components/SeatsSubNav";

interface SeatData {
  id: string;
  seatNumber: number;
  label: string;
  status: string;
  updatedAt?: string;
  registration: { id: string; fullName: string; email: string; checkedInAt: string | null } | null;
}

interface TableData {
  id: string;
  label: string;
  order: number;
  seats: SeatData[];
}

interface Booking {
  seatId: string;
  seatLabel: string;
  tableLabel: string;
  registrationId: string;
  fullName: string;
  email: string;
  checkedIn: boolean;
}

export default function SeatBookingsPage() {
  const [tables, setTables] = useState<TableData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

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

  const bookings: Booking[] = useMemo(() => {
    const list: Booking[] = [];
    for (const table of tables) {
      for (const seat of table.seats) {
        if (seat.registration) {
          list.push({
            seatId: seat.id,
            seatLabel: seat.label,
            tableLabel: table.label,
            registrationId: seat.registration.id,
            fullName: seat.registration.fullName,
            email: seat.registration.email,
            checkedIn: !!seat.registration.checkedInAt,
          });
        }
      }
    }
    return list.sort((a, b) => a.seatLabel.localeCompare(b.seatLabel, undefined, { numeric: true }));
  }, [tables]);

  const visible = search
    ? bookings.filter(
        (b) =>
          b.fullName.toLowerCase().includes(search.toLowerCase()) ||
          b.email.toLowerCase().includes(search.toLowerCase()) ||
          b.seatLabel.toLowerCase().includes(search.toLowerCase())
      )
    : bookings;

  return (
    <AdminShell active="/admin/seats">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">Seats</h2>
        <p className="text-muted text-sm mt-1">
          {bookings.length} seats booked
        </p>
      </div>

      <SeatsSubNav active="/admin/seats/bookings" />

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
                <th className="px-5 py-3 font-medium whitespace-nowrap">Table</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Attendance</th>
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
                    No seat bookings found.
                  </td>
                </tr>
              )}
              {!loading &&
                visible.map((b) => (
                  <tr key={b.seatId} className="border-b border-border/50 last:border-b-0">
                    <td className="sticky left-0 z-10 bg-pagebg px-5 py-4 whitespace-nowrap font-medium">
                      {b.fullName}
                    </td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">{b.email}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className="px-2.5 py-1 rounded-full border border-gold/40 text-goldlight text-xs font-semibold">
                        {b.seatLabel}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">{b.tableLabel}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {b.checkedIn ? (
                        <span className="text-emerald-400 text-xs">Checked in</span>
                      ) : (
                        <span className="text-muted text-xs">Not yet</span>
                      )}
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
