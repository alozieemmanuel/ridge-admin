"use client";

import { PAGE_SIZES } from "@/lib/clientCache";

/**
 * "Showing 1–50 of 6,000", a rows-per-page choice, and Previous / Next with the page number.
 * `page` starts at 1.
 */
export default function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const btn =
    "text-sm px-3.5 py-2 rounded-full border border-border text-muted hover:text-fg hover:border-gold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted disabled:hover:border-border whitespace-nowrap";

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap px-5 py-3 border-t border-border text-sm">
      <p className="text-muted">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-muted">
          <span className="whitespace-nowrap">Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(parseInt(e.target.value, 10))}
            className="bg-inputbg border border-border rounded-lg px-2.5 py-1.5 text-sm text-fg focus:outline-none focus:border-gold"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <button onClick={() => onPage(1)} disabled={page <= 1} className={btn} aria-label="First page">
            «
          </button>
          <button onClick={() => onPage(page - 1)} disabled={page <= 1} className={btn}>
            Previous
          </button>
          <span className="text-muted whitespace-nowrap px-1">
            Page {page.toLocaleString()} of {pages.toLocaleString()}
          </span>
          <button onClick={() => onPage(page + 1)} disabled={page >= pages} className={btn}>
            Next
          </button>
          <button onClick={() => onPage(pages)} disabled={page >= pages} className={btn} aria-label="Last page">
            »
          </button>
        </div>
      </div>
    </div>
  );
}
