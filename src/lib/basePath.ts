/**
 * The path the dashboard is served under. On the live site it is /event (so the picker is pertinencegroup.com/event
 * and an event is pertinencegroup.com/event/investor-hangout). Set NEXT_PUBLIC_BASE_PATH to change it; set it to an empty
 * value to serve from the root (for example on a spare domain). next.config.js reads the same setting.
 *
 * Safe to import from both server and client code.
 */
export const BASE_PATH: string = (process.env.NEXT_PUBLIC_BASE_PATH ?? "/event").replace(/\/+$/, "");

/** The first path segment after the base path: the event slug, or "" on the picker, login and team pages. */
export function slugFromPathname(pathname: string): string {
  const rest = BASE_PATH && pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) : pathname;
  const first = rest.split("/").filter(Boolean)[0] ?? "";
  return RESERVED_SLUGS.includes(first) || first === "api" ? "" : first;
}

/** Words that can never be an event address, because they are pages of the dashboard itself. */
export const RESERVED_SLUGS = ["login", "new", "team", "senders", "api", "admin", "events", "event", "_next", "static", "public", "favicon.ico"];
