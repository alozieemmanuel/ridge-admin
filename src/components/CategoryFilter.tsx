"use client";

import { REGISTRATION_CATEGORIES } from "@/lib/categories";

/**
 * A row of pills for the register page categories ("What best describes you?").
 * `value` is the selected category's full text, or "" for any category.
 */
export default function CategoryFilter({
  value,
  onChange,
  counts,
  allLabel = "All categories",
}: {
  value: string;
  onChange: (value: string) => void;
  counts?: Record<string, number> | null;
  allLabel?: string;
}) {
  const pill = (active: boolean) =>
    `text-sm px-4 py-2 rounded-full border transition-colors whitespace-nowrap ${
      active ? "border-gold text-goldlight bg-gold/10" : "border-border text-muted"
    }`;

  return (
    <div className="flex gap-2 flex-wrap">
      <button onClick={() => onChange("")} className={pill(value === "")}>
        {allLabel}
      </button>
      {REGISTRATION_CATEGORIES.map((c) => (
        <button key={c.value} onClick={() => onChange(c.value)} title={c.value} className={pill(value === c.value)}>
          {c.label}
          {counts && counts[c.value] !== undefined && <span className="ml-1.5 opacity-70">{counts[c.value]}</span>}
        </button>
      ))}
    </div>
  );
}
