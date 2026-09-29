"use client";

import { useEffect, useState } from "react";

export type ThemePreference = "dark" | "light" | "system";

const STORAGE_KEY = "ridge-theme";

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
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light" || v === "system") return v;
  } catch {
    // storage blocked: fall through to the default
  }
  return "dark";
}

const OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light mode",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark mode",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "Use system setting",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
];

/** Three-way theme switch: light, dark, or follow the device. Saved per browser. */
export default function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>("dark");

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
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage blocked: the choice still applies for this page view
    }
  }

  return (
    <div role="group" aria-label="Theme" className="inline-flex items-center rounded-full border border-border p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => choose(opt.value)}
          aria-label={opt.label}
          aria-pressed={pref === opt.value}
          title={opt.label}
          className={`h-8 w-8 flex items-center justify-center rounded-full transition-colors ${
            pref === opt.value ? "bg-gold/20 text-goldlight" : "text-muted hover:text-fg"
          }`}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
