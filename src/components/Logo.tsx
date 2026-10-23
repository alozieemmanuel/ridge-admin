"use client";

import { useState } from "react";
import { BRAND_NAME, LOGO_URL, LOGO_WHITE_URL } from "@/lib/brand";

/**
 * The logo, loaded from src/lib/brand.ts. The dark logo is shown on the light theme and the white logo on the dark theme
 * (see .logo-light and .logo-dark in globals.css). If the white logo can't be loaded, the dark one is turned white instead.
 * If no logo can be loaded, the name is shown as text.
 */
export default function Logo({ className = "h-10 w-auto", showFallbackText = true }: { className?: string; showFallbackText?: boolean }) {
  const [missing, setMissing] = useState(false);
  const [whiteMissing, setWhiteMissing] = useState(false);

  if (missing) {
    if (!showFallbackText) return null;
    return <span className="font-serif text-2xl leading-none">{BRAND_NAME}</span>;
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO_URL} alt={BRAND_NAME} width={456} height={110} decoding="async" fetchPriority="high" className={`${className} ${whiteMissing ? "logo-adaptive" : "logo-light"}`} onError={() => setMissing(true)} />
      {!whiteMissing && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={LOGO_WHITE_URL} alt={BRAND_NAME} width={456} height={110} decoding="async" className={`${className} logo-dark`} onError={() => setWhiteMissing(true)} />
      )}
    </>
  );
}
