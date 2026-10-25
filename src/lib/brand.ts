/**
 * Names and logo used across the dashboard, the public reserve page and the emails.
 * Change them here (or set NEXT_PUBLIC_LOGO_URL) and everything follows.
 */
/** The platform name. Each event has its own name (Event settings), shown on its pages and in its emails. */
export const BRAND_NAME = "Pertinence Group";

/**
 * The logo is loaded from this address (dashboard, login, reserve page and emails alike; mail apps need a
 * full https:// link anyway). It is the dark version of the logo, which suits the white pages and emails.
 */
export const LOGO_URL =
  process.env.NEXT_PUBLIC_LOGO_URL || "https://pertinencegroup.com/wp-content/uploads/2026/04/Pertinence-Group-Dark-scaled.png";

/** The white version of the logo, shown instead of LOGO_URL when the dashboard is in dark mode. Not used in emails. */
export const LOGO_WHITE_URL =
  process.env.NEXT_PUBLIC_LOGO_WHITE_URL || "https://pertinencegroup.com/wp-content/uploads/2026/04/Pertinence-Group-White-scaled.png";

/** The site icon (browser tab, bookmarks, phone home screen). */
export const ICON_URL = process.env.NEXT_PUBLIC_ICON_URL || "https://pertinencegroup.com/wp-content/uploads/2022/04/cropped-download-6.png";
