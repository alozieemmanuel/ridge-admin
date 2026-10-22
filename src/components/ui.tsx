"use client";

import type { ReactNode } from "react";
import Link from "next/link";

/** Shared bits of styling so every screen looks the same. */
export const primaryButton =
  "text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-[#141C08] font-semibold uppercase tracking-widest whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed";
export const ghostButton =
  "text-sm px-4 py-2.5 rounded-full border border-border text-fg hover:border-gold transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed";
export const inputClass =
  "w-full bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between flex-wrap gap-4 mb-7">
      <div>
        <h2 className="font-serif text-3xl">{title}</h2>
        {subtitle && <p className="text-muted text-sm mt-1.5 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 flex-wrap">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "text-fg",
  onClick,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string;
  onClick?: () => void;
  /** Makes the whole card a link to the module (and filter) behind the number. */
  href?: string;
}) {
  const inner = (
    <>
      <p className="text-xs uppercase tracking-wider text-muted mb-2">{label}</p>
      <p className={`font-serif text-3xl leading-none ${tone}`}>{value}</p>
      {hint && <p className="text-xs text-muted mt-2">{hint}</p>}
    </>
  );
  const cls = "border border-border rounded-xl px-5 py-4 bg-cardbg text-left";
  if (href) {
    return (
      <Link href={href} className={`${cls} block hover:border-gold hover:shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold`}>
        {inner}
      </Link>
    );
  }
  return onClick ? (
    <button onClick={onClick} className={`${cls} hover:border-gold transition-colors`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function Pill({ children, tone = "text-muted" }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-block px-2.5 py-1 rounded-full border border-border text-xs whitespace-nowrap ${tone}`}>{children}</span>;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
