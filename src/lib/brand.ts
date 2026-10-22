/**
 * Names and logo used across the dashboard, the public reserve page and the emails.
 * Change them here (or set NEXT_PUBLIC_LOGO_URL) and everything follows.
 */
export const BRAND_NAME = "Investor Hangout";
export const EVENT_NAME = "Investor Breakfast Hangout";

/**
 * The logo is loaded from this address (dashboard, login, reserve page and emails alike; mail apps need a
 * full https:// link anyway). It is the dark version of the logo, which suits the white pages and emails.
 */
export const LOGO_URL =
  process.env.NEXT_PUBLIC_LOGO_URL || "https://pertinencegroup.com/wp-content/uploads/2026/04/Pertinence-Group-Dark-scaled.png";
