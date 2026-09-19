"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";

interface RegistrationRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  country: string;
  organization: string | null;
  regType: "EARLY_BIRD" | "LATE";
  deliveryStatus: string;
  seatLabel: string | null;
  createdAt: string;
}

interface EmailStats {
  delivered: number;
  opened: number;
  bounced: number;
  failed: number;
  sentOnly: number;
  notSent: number;
}

const STATUS_STYLES: Record<string, string> = {
  OPENED: "text-emerald-400",
  DELIVERED: "text-emerald-400",
  SENT: "text-goldlight",
  BOUNCED: "text-red-400",
  FAILED: "text-red-400",
  COMPLAINED: "text-red-400",
  NOT_SENT: "text-muted",
};

function StatusDot({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${STATUS_STYLES[status] ?? "text-muted"}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}
    </span>
  );
}

export default function RegistrationsPage() {
  const [rows, setRows] = useState<RegistrationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [search, setSearch] = useState("");
  const [regType, setRegType] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (regType !== "ALL") params.set("regType", regType);
    const res = await fetch(`/api/admin/registrations?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setRows(data.registrations);
      setTotal(data.total);
      setStats(data.emailStats);
    }
    setLoading(false);
  }, [search, regType]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce search typing
    return () => clearTimeout(t);
  }, [load]);

  return (
    <AdminShell active="/admin">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h2 className="font-serif text-2xl">Registrations</h2>
          <p className="text-muted text-sm mt-1">{total} total</p>
        </div>
        <a
          href="/api/admin/registrations/export"
          className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest"
        >
          Export CSV
        </a>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {["ALL", "EARLY_BIRD", "LATE"].map((rt) => (
          <button
            key={rt}
            onClick={() => setRegType(rt)}
            className={`text-sm px-4 py-2 rounded-full border transition-colors ${
              regType === rt ? "border-gold text-goldlight bg-gold/10" : "border-border text-muted"
            }`}
          >
            {rt === "ALL" ? "All" : rt === "EARLY_BIRD" ? "Early Bird" : "Late"}
          </button>
        ))}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, email or phone"
        className="w-full max-w-md bg-cardbg border border-border rounded-lg px-4 py-2.5 text-sm mb-4 focus:outline-none focus:border-gold"
      />

      {stats && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm mb-6">
          <span className="text-muted">Emails:</span>
          <StatusDot status="DELIVERED" /> <span className="text-muted -ml-4">{stats.delivered}</span>
          <StatusDot status="OPENED" /> <span className="text-muted -ml-4">{stats.opened}</span>
          <StatusDot status="BOUNCED" /> <span className="text-muted -ml-4">{stats.bounced}</span>
          <StatusDot status="FAILED" /> <span className="text-muted -ml-4">{stats.failed}</span>
          <StatusDot status="NOT_SENT" /> <span className="text-muted -ml-4">{stats.notSent}</span>
        </div>
      )}

      <div className="border border-border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Phone</th>
              <th className="px-5 py-3 font-medium">Country</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Seat</th>
              <th className="px-5 py-3 font-medium">Delivery</th>
              <th className="px-5 py-3 font-medium">Registered</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-muted">
                  No registrations found.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="border-b border-border/50 last:border-b-0">
                  <td className="px-5 py-4">{r.fullName}</td>
                  <td className="px-5 py-4 text-muted">{r.email}</td>
                  <td className="px-5 py-4 text-muted">{r.phone}</td>
                  <td className="px-5 py-4 text-muted">{r.country}</td>
                  <td className="px-5 py-4">
                    <span className="px-2.5 py-1 rounded-full border border-border text-xs">
                      {r.regType === "LATE" ? "Late" : "Early Bird"}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {r.seatLabel ? (
                      <span className="px-2.5 py-1 rounded-full border border-gold/40 text-goldlight text-xs font-semibold">
                        {r.seatLabel}
                      </span>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <StatusDot status={r.deliveryStatus} />
                  </td>
                  <td className="px-5 py-4 text-muted whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
