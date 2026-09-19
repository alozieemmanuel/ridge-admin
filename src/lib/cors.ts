import { NextRequest, NextResponse } from "next/server";

// Origins allowed to call the public endpoints from a browser.
// Set PUBLIC_SITE_ORIGINS in the environment as a comma-separated list, e.g.
//   PUBLIC_SITE_ORIGINS=https://pertinencegroup.com,https://www.pertinencegroup.com,https://theridgecircle.com
// If it is unset, it falls back to the defaults below.
const DEFAULT_ORIGINS = [
  "https://pertinencegroup.com",
  "https://www.pertinencegroup.com",
  "https://theridgecircle.com",
  "https://www.theridgecircle.com",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
];

function allowedOrigins(): string[] {
  const fromEnv = process.env.PUBLIC_SITE_ORIGINS;
  if (!fromEnv) return DEFAULT_ORIGINS;
  return fromEnv
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allowedOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

/** Answers the browser's preflight request. */
export function preflight(request: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

/** JSON response with CORS headers attached. */
export function jsonWithCors(request: NextRequest, body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders(request) });
}