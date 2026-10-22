"use client";

import { useEffect, useState } from "react";

export type ThemePreference = "dark" | "light" | "system";

export const THEME_STORAGE_KEY = "hangout-theme";

function resolve(pref: ThemePreference): "dark" | "light" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

function apply(pref: ThemePreference) {
  document.documentElement.setAttribute("data-theme", resolve(pref));
}

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "dark" || v === "light" || v === "system") return v;
  } catch {
    // storage blocked: fall through to the default
  }
  return "light";
}

const OPTIONS: { value: ThemePreference; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    hint: "White and lemon green",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    hint: "Easier on the eyes at night",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "Device setting",
    hint: "Follows your phone or computer",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
];

/** Light, dark, or follow the device. Saved in this browser only. Lives on the Settings page. */
export default function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>("light");

  useEffect(() => {
    setPref(readStored());
  }, []);

  // While on "system", follow the device if it flips between light and dark.
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  function choose(next: ThemePreference) {
    setPref(next);
    apply(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // storage blocked: the choice still applies for this page view
    }
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {OPTIONS.map((opt) => {
        const selected = pref === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => choose(opt.value)}
            className={`text-left rounded-xl border px-4 py-3.5 transition-colors ${
              selected ? "border-gold bg-gold/10" : "border-border hover:border-gold/60"
            }`}
          >
            <span className={`flex items-center gap-2.5 text-sm font-medium ${selected ? "text-goldlight" : ""}`}>
              {opt.icon}
              {opt.label}
            </span>
            <span className="block text-xs text-muted mt-1.5">{opt.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
