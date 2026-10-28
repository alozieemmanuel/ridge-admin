import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE_NAME } from "@/lib/session-constants";
import { DISABLED_API_PREFIXES, startsWithAny } from "@/lib/modules";

/**
 * Everything below runs with the base path (/event) already removed from request.nextUrl.pathname.
 *
 *   /login                       open
 *   /<event>/reserve             open (the guest's own link)
 *   /<event>/test                open (the test portal, guests sign in with their ticket code)
 *   /api/public/*                open (each route checks its own signed token)
 *   everything else              needs the admin session cookie
 *
 * Whether the admin may open a particular event is checked in the API routes (requireEvent) and the event pages.
 */
const PUBLIC_PAGE = /^\/login\/?$|^\/[^/]+\/(reserve|test)\/?$/;
const PUBLIC_API = new Set(["/api/admin/login"]);

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET is missing or too short (needs 32+ characters).");
  }
  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Switched-off modules (see src/lib/modules.ts): their APIs answer 404.
  if (startsWithAny(pathname, DISABLED_API_PREFIXES) || /^\/api\/admin\/registrations\/[^/]+\/payment$/.test(pathname)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // The old address layout (/admin/...) has no meaning any more: go to the event list.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const isApi = pathname.startsWith("/api/");
  if (isApi) {
    if (pathname.startsWith("/api/public/") || pathname.startsWith("/api/webhooks/") || pathname.startsWith("/api/cron/") || PUBLIC_API.has(pathname)) return NextResponse.next();
  } else if (PUBLIC_PAGE.test(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  let valid = false;
  if (token) {
    try {
      await jwtVerify(token, getSecretKey());
      valid = true;
    } catch {
      valid = false;
    }
  }
  if (valid) return NextResponse.next();

  if (isApi) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Every page and API route, except Next's own files and the icon.
  matcher: ["/", "/((?!_next/|favicon.ico|icon|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js|map)$).*)"],
};
