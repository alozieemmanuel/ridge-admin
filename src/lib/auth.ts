import bcrypt from "bcryptjs";
import { isRole, type Role } from "@/lib/roles";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME } from "@/lib/session-constants";
import { BASE_PATH } from "@/lib/basePath";

export { SESSION_COOKIE_NAME };
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Set a random string of at least 32 characters in your environment."
    );
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  adminId: string;
  email: string;
  name: string;
  role: Role;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}

/**
 * Checks the token's signature and expiry only. It does NOT look at the
 * database, so it is safe to call from middleware / the edge runtime.
 * Use getSession() in route handlers and server components, which also
 * confirms the admin still exists and hasn't been archived.
 */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.adminId === "string" &&
      typeof payload.email === "string" &&
      typeof payload.name === "string" &&
      isRole(payload.role)
    ) {
      return {
        adminId: payload.adminId,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Reads and verifies the session from cookies in a Server Component or Route
 * Handler. On top of the token check, it confirms against the database that
 * the admin still exists and isn't archived, and it returns their CURRENT
 * name, email and role rather than what was stored in the token at login.
 * So archiving, removing, editing or demoting an admin takes effect on their
 * very next request instead of after the 7-day token expires.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifySessionToken(token);
  if (!session) return null;

  const admin = await prisma.admin.findUnique({
    where: { id: session.adminId },
    select: { id: true, name: true, email: true, role: true, archivedAt: true },
  });
  if (!admin || admin.archivedAt) return null;

  return {
    adminId: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  };
}

/**
 * Cookie helpers. They write Set-Cookie headers straight onto the response instead of using cookies() from next/headers,
 * because cookies().set() keeps ONE entry per cookie name: setting the same name twice (the new /event cookie, then the
 * removal of the old "/" cookie) silently drops the first, so the browser only ever received the removal and no session
 * cookie was stored. Raw headers can carry both.
 */
function serializeCookie(value: string, path: string, maxAge: number): string {
  const parts = [`${SESSION_COOKIE_NAME}=${value}`, `Path=${path}`, `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Lax"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

/** Adds the session cookie (scoped to the base path) to a response, and removes any cookie left over from the old "/" address layout. */
export function applySessionCookie<T extends Response>(response: T, token: string): T {
  response.headers.append("Set-Cookie", serializeCookie(token, BASE_PATH || "/", SESSION_DURATION_SECONDS));
  if (BASE_PATH) response.headers.append("Set-Cookie", serializeCookie("", "/", 0));
  return response;
}

/** Adds headers to a response that remove the session cookie at both the base path and the old "/" path. */
export function applyClearedSessionCookie<T extends Response>(response: T): T {
  response.headers.append("Set-Cookie", serializeCookie("", BASE_PATH || "/", 0));
  if (BASE_PATH) response.headers.append("Set-Cookie", serializeCookie("", "/", 0));
  return response;
}
