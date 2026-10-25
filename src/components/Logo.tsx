"use client";

import { useState } from "react";
import { BRAND_NAME, LOGO_URL, LOGO_WHITE_URL } from "@/lib/brand";
import { BASE_PATH } from "@/lib/basePath";

/** A logo address that works in the browser: an uploaded file has no base path in its saved address. */
export function assetUrl(url: string): string {
  return url.startsWith("/") ? `${BASE_PATH}${url}` : url;
}

/**
 * The logo. By default the platform's own (src/lib/brand.ts); an event passes its own `src`, `darkSrc` and `name`.
 * The normal logo is shown on the light theme and the white one on the dark theme (see .logo-light and .logo-dark in globals.css).
 * If there is no white platform logo, the normal one is turned white. An event logo without a white version sits on a white chip in dark mode. If no logo loads, the name is shown as text.
 */
export default function Logo({
  className = "h-10 w-auto",
  showFallbackText = true,
  src,
  darkSrc,
  name,
}: {
  className?: string;
  showFallbackText?: boolean;
  src?: string | null;
  darkSrc?: string | null;
  name?: string;
}) {
  const [missing, setMissing] = useState(false);
  const [whiteMissing, setWhiteMissing] = useState(false);
  const own = Boolean(src);
  const label = name || BRAND_NAME;
  const light = src ? assetUrl(src) : LOGO_URL;
  const dark = darkSrc ? assetUrl(darkSrc) : own ? null : LOGO_WHITE_URL;

  if (missing) {
    if (!showFallbackText) return null;
    return <span className="font-serif text-2xl leading-none">{label}</span>;
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={light} alt={label} decoding="async" fetchPriority="high" className={`${className} ${whiteMissing || !dark ? (own ? "logo-chip" : "logo-adaptive") : "logo-light"}`} onError={() => setMissing(true)} {...(own ? {} : { width: 456, height: 110 })} />
      {dark && !whiteMissing && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dark} alt={label} decoding="async" className={`${className} logo-dark`} onError={() => setWhiteMissing(true)} {...(own ? {} : { width: 456, height: 110 })} />
      )}
    </>
  );
}
