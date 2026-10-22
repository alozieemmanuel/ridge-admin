"use client";

import { useState } from "react";
import { BRAND_NAME, LOGO_URL } from "@/lib/brand";

/**
 * The Investor Hangout logo, loaded from LOGO_URL (src/lib/brand.ts).
 * It is the dark version of the logo, so on the dark theme it is turned white (see .logo-adaptive in globals.css).
 * If the image can't be loaded, the name is shown as text instead.
 */
export default function Logo({ className = "h-10 w-auto", showFallbackText = true }: { className?: string; showFallbackText?: boolean }) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    if (!showFallbackText) return null;
    return <span className="font-serif text-2xl leading-none">{BRAND_NAME}</span>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={LOGO_URL} alt={BRAND_NAME} width={456} height={110} decoding="async" fetchPriority="high" className={`${className} logo-adaptive`} onError={() => setMissing(true)} />
  );
}
