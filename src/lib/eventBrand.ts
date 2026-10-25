import { BASE_PATH } from "@/lib/basePath";
import { appBaseUrl } from "@/lib/email";
import { LOGO_URL, LOGO_WHITE_URL, BRAND_NAME } from "@/lib/brand";
import { DEFAULT_COLOR, normalizeHex } from "@/lib/eventTheme";

/** A logo address that works outside the dashboard (emails, other sites): uploaded files get the full https address. */
export function absoluteAssetUrl(url: string | null | undefined): string {
  if (!url) return "";
  return url.startsWith("/") ? `${appBaseUrl()}${BASE_PATH}${url}` : url;
}

export interface EventBrandFields {
  brandName: string | null;
  color: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
}

/** What an event looks like to the outside: its name, colour and logos, with the platform's own as the fallback. */
export function brandOf(event: EventBrandFields & { name: string }) {
  return {
    name: event.brandName?.trim() || event.name || BRAND_NAME,
    color: normalizeHex(event.color) ?? DEFAULT_COLOR,
    logoUrl: absoluteAssetUrl(event.logoUrl) || LOGO_URL,
    logoDarkUrl: absoluteAssetUrl(event.logoDarkUrl) || absoluteAssetUrl(event.logoUrl) || LOGO_WHITE_URL,
    hasOwnLogo: Boolean(event.logoUrl),
  };
}
