"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import ImportDialog from "@/components/ImportDialog";
import SheetSyncDialog from "@/components/SheetSyncDialog";
import Pagination from "@/components/Pagination";
import { Pill, PageHeader, formatDate, ghostButton, inputClass, primaryButton } from "@/components/ui";
import { FOLLOW_UP_STATUSES, followUpLabel, followUpTone } from "@/lib/followUp";
import { cacheDeletePrefix, cacheGet, cacheSet, getStoredPageSize, storePageSize } from "@/lib/clientCache";
import { useAutoRefresh } from "@/lib/useAutoRefresh";

interface Row {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  followUpStatus: string;
  inviteSentAt: string | null;
  reservedAt: string | null;
  checkedInAt: string | null;
}
interface Response {
  registrations: Row[];
  total: number;
  counts: { all: number; reserved: number; notReserved: number; followUp: Record<string, number> };
}

function RegistrationsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [pageSize, setPageSize] = useState(() => getStoredPageSize());
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [followUp, setFollowUp] = useState(params.get("followUp") ?? "");
  const [seat, setSeat] = useState(params.get("seat") ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Response["counts"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetLinked, setSheetLinked] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (silent = false) => {
      const mine = ++requestId.current;
      if (!silent) setLoading(true);
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (query) p.set("search", query);
      if (followUp) p.set("followUp", followUp);
      if (seat) p.set("seat", seat);
      const url = `/api/admin/registrations?${p}`;
      // Show what this same view had last time straight away, then refresh it quietly.
      const cached = !silent ? cacheGet<Response>(url) : undefined;
      if (cached) {
        setRows(cached.registrations);
        setTotal(cached.total);
        setCounts(cached.counts);
        setLoading(false);
      }
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok && mine === requestId.current) {
          const data: Response = await res.json();
          cacheSet(url, data);
          setRows(data.registrations);
          setTotal(data.total);
          setCounts(data.counts);
          if (data.registrations.length === 0 && page > 1 && data.total > 0) setPage(Math.max(1, Math.ceil(data.total / pageSize)));
        }
      } catch {
        // keep showing the last data; the next refresh retries
      } finally {
        if (mine === requestId.current) setLoading(false);
      }
    },
    [page, pageSize, query, followUp, seat]
  );

  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(() => load(true), 30_000);

  // With a live sheet linked, the list is synced when this page opens and every 5 minutes while it stays open.
  const syncSheet = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/registrations/sheet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auto: true }) });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.result === "synced" && (json.added || json.updated)) {
        cacheDeletePrefix("/api/admin/registrations?");
        cacheDeletePrefix("/api/admin/overview");
        await load(true);
      }
    } catch {
      // the next run tries again
    }
  }, [load]);
  const syncSheetRef = useRef(syncSheet);
  useEffect(() => {
    syncSheetRef.current = syncSheet;
  }, [syncSheet]);
  useEffect(() => {
    fetch("/api/admin/registrations/sheet", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const linked = Boolean(data.url);
        setSheetLinked(linked);
        if (linked) void syncSheetRef.current();
      })
      .catch(() => {});
  }, []);
  useAutoRefresh(() => {
    if (sheetLinked) void syncSheet();
  }, 300_000);

  const anyFilter = Boolean(query || followUp || seat);

  return (
    <AdminShell active="/admin/registrations">
      <PageHeader
        title="Contacts"
        subtitle={`${(counts?.all ?? 0).toLocaleString()} contacts on the list. Click a contact to open their full record.`}
        actions={
          <>
            <a href="/api/admin/registrations/export" className={ghostButton}>
              Export CSV
            </a>
            <button onClick={() => setSheetOpen(true)} className={ghostButton}>
              {sheetLinked ? "Live sheet" : "Connect live sheet"}
            </button>
            <button onClick={() => setImporting(true)} className={primaryButton}>
              Import CSV
            </button>
          </>
        }
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email or phone" className={`${inputClass} sm:max-w-md`} aria-label="Search contacts" />
        <select
          value={followUp}
          onChange={(e) => {
            setFollowUp(e.target.value);
            setPage(1);
          }}
          className={`${inputClass} sm:w-56`}
          aria-label="Filter by follow-up"
        >
          <option value="">All follow-up</option>
          <option value="CONTACTED">Contacted (any call)</option>
          {FOLLOW_UP_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
              {counts ? ` (${counts.followUp[s.value] ?? 0})` : ""}
            </option>
          ))}
        </select>
        <select
          value={seat}
          onChange={(e) => {
            setSeat(e.target.value);
            setPage(1);
          }}
          className={`${inputClass} sm:w-52`}
          aria-label="Filter by seat"
        >
          <option value="">Seat: any</option>
          <option value="RESERVED">Reserved{counts ? ` (${counts.reserved})` : ""}</option>
          <option value="NOT_RESERVED">Not reserved{counts ? ` (${counts.notReserved})` : ""}</option>
          <option value="INVITED">Invited (any)</option>
          <option value="AWAITING">Invited, no reply yet</option>
          <option value="NOT_INVITED">Not invited yet</option>
        </select>
      </div>

      <div className="border border-border rounded-xl overflow-hidden bg-cardbg">
        <div className="table-scroll overflow-auto max-h-[68vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                {["Name", "Email", "Phone", "Follow-up", "Seat reserved"].map((h, i) => (
                  <th key={h} className={`sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap ${i === 0 ? "left-0 z-30" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-muted">
                    {anyFilter ? (
                      "Nobody matches that."
                    ) : (
                      <>
                        No contacts yet.{" "}
                        <button onClick={() => setSheetOpen(true)} className="text-goldlight underline">
                          Connect your live sheet
                        </button>{" "}
                        or{" "}
                        <button onClick={() => setImporting(true)} className="text-goldlight underline">
                          import a CSV
                        </button>{" "}
                        to get started.
                      </>
                    )}
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => router.push(`/admin/registrations/${r.id}`)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), router.push(`/admin/registrations/${r.id}`))}
                    className="border-b border-border/50 last:border-b-0 cursor-pointer hover:bg-gold/10 focus:bg-gold/10 focus:outline-none"
                  >
                    <td className="sticky left-0 z-10 bg-inherit px-5 py-3.5 whitespace-nowrap font-medium">
                      {r.fullName}
                    </td>
                    <td className="px-5 py-3.5 text-muted whitespace-nowrap">{r.email}</td>
                    <td className="px-5 py-3.5 text-muted whitespace-nowrap">{r.phone || "-"}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <Pill tone={followUpTone(r.followUpStatus)}>{followUpLabel(r.followUpStatus)}</Pill>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {r.reservedAt ? (
                        <span className="inline-flex items-center gap-2">
                          <Pill tone="text-emerald-400">Reserved</Pill>
                          <span className="text-xs text-muted">{formatDate(r.reservedAt)}</span>
                        </span>
                      ) : r.inviteSentAt ? (
                        <Pill tone="text-amber-300">Invited</Pill>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPage={setPage}
          onPageSize={(n) => {
            storePageSize(n);
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>

      {importing && <ImportDialog onClose={() => setImporting(false)} onImported={() => load(true)} />}
      {sheetOpen && (
        <SheetSyncDialog
          onClose={() => {
            setSheetOpen(false);
            fetch("/api/admin/registrations/sheet", { cache: "no-store" })
              .then((res) => res.json())
              .then((data) => setSheetLinked(Boolean(data.url)))
              .catch(() => {});
          }}
          onSynced={() => load(true)}
        />
      )}
    </AdminShell>
  );
}

export default function RegistrationsPage() {
  return (
    <Suspense fallback={null}>
      <RegistrationsInner />
    </Suspense>
  );
}
