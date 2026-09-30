"use client";

import { useState } from "react";

/**
 * ridge-logo.png       white logo, shown in dark mode
 * ridge-logo-dark.png  dark logo, shown in light mode
 * If the dark file is missing, the white logo is turned solid black in light mode.
 */
export default function Logo({ className = "h-10 w-auto", showFallbackText = true }: { className?: string; showFallbackText?: boolean }) {
  const [missing, setMissing] = useState(false);
  const [lightMissing, setLightMissing] = useState(false);

  if (missing) {
    if (!showFallbackText) return null;
    return (
      <span className="font-serif text-2xl leading-none">
        RIDGE<span className="text-gold">.</span>
      </span>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/ridge-logo.png"
        alt="RIDGE"
        className={`${className} ${lightMissing ? "logo-flatten" : "logo-swap-dark"}`}
        onError={() => setMissing(true)}
      />
      {!lightMissing && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/ridge-logo-dark.png"
          alt="RIDGE"
          className={`${className} logo-swap-light`}
          onError={() => setLightMissing(true)}
        />
      )}
    </>
  );
}