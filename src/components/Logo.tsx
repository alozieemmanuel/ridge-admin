"use client";

import { useState } from "react";

/**
 * RIDGE logo. Drop your logo file into the /public folder as `ridge-logo.png`
 * (or change LOGO_SRC below). Until that file exists, this falls back to the
 * text wordmark, so nothing looks broken in the meantime.
 */
export const LOGO_SRC = "/ridge-logo.png";

export default function Logo({ className = "h-10 w-auto", showFallbackText = true }: { className?: string; showFallbackText?: boolean }) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    if (!showFallbackText) return null;
    return (
      <span className="font-serif text-2xl leading-none">
        RIDGE<span className="text-gold">.</span>
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={LOGO_SRC} alt="RIDGE" className={className} onError={() => setMissing(true)} />
  );
}
