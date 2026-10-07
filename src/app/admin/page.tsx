"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AdminShell from "@/components/AdminShell";
import RegistrationActionsMenu, { runRegistrationAction, type RegistrationAction } from "@/components/RegistrationActionsMenu";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { useIsOwner } from "@/lib/useIsOwner";
import CategoryFilter from "@/components/CategoryFilter";
import { categoryLabel } from "@/lib/categories";
import Pagination from "@/components/Pagination";
import { cacheGet, cacheSet, getStoredPageSize, storePageSize } from "@/lib/clientCache";
import { registrationsUrl } from "@/lib/adminData";

interface RegistrationRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  country: string;
  categories: string[];
  regType: "EARLY_BIRD" | "LATE";
  createdAt: string;
}

interface RegistrationsResponse {
  registrations: RegistrationRow[];
  total: number;
  regTypeCounts?: { all: number; earlyBird: number; late: number };
  categoryCounts?: Record<string, number>;
}

export default function RegistrationsPage() {
  const [pageSize, setPageSize] = useState(() => getStoredPageSize());
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // the search text, after the typing pause
  const [regType, setRegType] = useState<string>("ALL");
  const [category, setCategory] = useState<string>("");

  // What this page showed last time is on screen straight away; fresh data replaces it a moment later.
  const firstUrl = registrationsUrl({ page: 1, pageSize, regType: "ALL" });
  const [initial] = useState(() => cacheGet<RegistrationsResponse>(firstUrl));
  const [rows, setRows] = useState<RegistrationRow[]>(initial?.registrations ?? []);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [regTypeCounts, setRegTypeCounts] = useState<RegistrationsResponse["regTypeCounts"] | null>(initial?.regTypeCounts ?? null);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number> | null>(initial?.categoryCounts ?? null);
  const [loading, setLoading] = useState(!initial);
  const [actionMessage, setActionMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const isOwner = useIsOwner();
  const requestId = useRef(0);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wait a moment after typing before searching.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  function changeType(v: string) {
    setRegType(v);
    setPage(1);
  }
  function changeCategory(v: string) {
    setCategory(v);
    setPage(1);
  }
  function changePageSize(n: number) {
    storePageSize(n);
    setPageSize(n);
    setPage(1);
  }

  // `silent` refreshes (the auto-refresh poll) update the rows in place without
  // flashing the "Loading…" state. The counter drops stale responses so a slow
  // background refresh can never overwrite newer search/filter results.
  const load = useCallback(
    async (silent = false) => {
      const myRequest = ++requestId.current;
      const url = registrationsUrl({ page, pageSize, search: query, regType, category });
      const apply = (data: RegistrationsResponse) => {
        setRows(data.registrations);
        setTotal(data.total);
        if (data.regTypeCounts) setRegTypeCounts(data.regTypeCounts);
        if (data.categoryCounts) setCategoryCounts(data.categoryCounts);
      };
      if (!silent) {
        const cached = cacheGet<RegistrationsResponse>(url);
        if (cached) {
          apply(cached);
          setLoading(false);
        } else {
          setLoading(true);
        }
      }
      try {
        const res = await fetch(url);
        if (res.ok && myRequest === requestId.current) {
          const data: RegistrationsResponse = await res.json();
          cacheSet(url, data);
          apply(data);
          // Deleting the last row of the last page leaves an empty page: step back.
          if (data.registrations.length === 0 && page > 1 && data.total > 0) {
            setPage(Math.max(1, Math.ceil(data.total / pageSize)));
          }
        }
      } catch {
        // Network hiccup: keep showing the last data; the next poll will retry.
      } finally {
        if (myRequest === requestId.current) setLoading(false);
      }
    },
    [page, pageSize, query, regType, category]
  );

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefresh(() => load(true), 10_000);

  function flash(text: string, ok: boolean) {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setActionMessage({ text, ok });
    messageTimer.current = setTimeout(() => setActionMessage(null), ok ? 4000 : 10000);
  }

  async function handleAction(id: string, action: RegistrationAction) {
    flash("Sending…", true);
    const result = await runRegistrationAction(id, action);
    flash(result.message, result.ok);
    load(true);
  }

  async function handleDelete(row: RegistrationRow) {
    if (!window.confirm(`Permanently delete the registration for ${row.fullName} (${row.email})? This cannot be undone.`)) {
      return;
    }
    const res = await fetch(`/api/admin/registrations/${row.id}`, { method: "DELETE" });
    if (res.ok) {
      flash("Registration deleted.", true);
      load(true);
    } else {
      const data = await res.json().catch(() => ({}));
      flash(data.error || "Failed to delete.", false);
    }
  }

  return (
    <AdminShell active="/admin">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h2 className="font-serif text-2xl">Registrations</h2>
          <p className="text-muted text-sm mt-1">
            {total.toLocaleString()} total
            {actionMessage && (
              <span className={`ml-3 ${actionMessage.ok ? "text-goldlight" : "text-red-400"}`}>{actionMessage.text}</span>
            )}
          </p>
        </div>
        <a
          href="/api/admin/registrations/export"
          className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest whitespace-nowrap"
        >
          Export CSV
        </a>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {["ALL", "EARLY_BIRD", "LATE"].map((rt) => {
          const count =
            rt === "ALL" ? regTypeCounts?.all : rt === "EARLY_BIRD" ? regTypeCounts?.earlyBird : regTypeCounts?.late;
          return (
            <button
              key={rt}
              onClick={() => changeType(rt)}
              className={`text-sm px-4 py-2 rounded-full border transition-colors whitespace-nowrap ${
                regType === rt ? "border-gold text-goldlight bg-gold/10" : "border-border text-muted"
              }`}
            >
              {rt === "ALL" ? "All" : rt === "EARLY_BIRD" ? "Early Bird" : "Late"}
              {count !== undefined && <span className="ml-1.5 opacity-70">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="mb-4">
        <CategoryFilter value={category} onChange={changeCategory} counts={categoryCounts} />
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, email or phone"
        className="w-full max-w-md bg-cardbg border border-border rounded-lg px-4 py-2.5 text-sm mb-6 focus:outline-none focus:border-gold"
      />

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="table-scroll overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                <th className="sticky left-0 top-0 z-30 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Name</th>
                <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Email</th>
                <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Phone</th>
                <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Category</th>
                <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Country</th>
                <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Type</th>
                <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Registered</th>
                <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap"></th>
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
                  <tr key={r.id} className="border-b border-border/50 last:border-b-0 align-top">
                    <td className="sticky left-0 z-10 bg-pagebg px-5 py-4 whitespace-nowrap font-medium">
                      {r.fullName}
                    </td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">{r.email}</td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">{r.phone}</td>
                    <td className="px-5 py-4">
                      {r.categories.length === 0 ? (
                        <span className="text-muted text-xs">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 max-w-[16rem]">
                          {r.categories.map((c) => (
                            <span
                              key={c}
                              title={c}
                              className="px-2.5 py-1 rounded-full border border-border text-xs whitespace-nowrap"
                            >
                              {categoryLabel(c)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">{r.country}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className="px-2.5 py-1 rounded-full border border-border text-xs whitespace-nowrap">
                        {r.regType === "LATE" ? "Late" : "Early Bird"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <RegistrationActionsMenu
                        variant="registration"
                        phone={r.phone}
                        fullName={r.fullName}
                        onAction={(action) => handleAction(r.id, action)}
                        onDelete={isOwner ? () => handleDelete(r) : undefined}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={changePageSize} />
      </div>

    </AdminShell>
  );
}