import { sendViaGmail, type GmailAttachment } from "./gmail";
import { BRAND_NAME, LOGO_URL } from "./brand";
import { DEFAULT_COLOR, mix, normalizeHex, onColor, textOnWhite } from "./eventTheme";

// Brand palette: white and lemon green (the platform default). An event with its own colour overrides the accent
// parts (button, badges, borders, tints) while an email is being rendered; see withBrand() below.
// Solid hex values only (no rgba) so it also renders correctly in Outlook and other older mail apps.
// (The key called "red" is the accent colour.)
export interface EmailBrand {
  name: string;
  color: string;
  logoUrl: string;
}

let active: { name: string; color: string; logoUrl: string } | null = null;
/** The event's colour, or null while it is the default one (the original palette is then used as it is). */
function custom(): string | null {
  return active && active.color !== DEFAULT_COLOR ? active.color : null;
}

const BRAND = {
  cardBg: "#FFFFFF",
  fg: "#141C08",
  muted: "#5B664A",
  footerMuted: "#7B876A",
  get pageBg() {
    const c = custom();
    return c ? mix(c, "#FFFFFF", 0.92) : "#F4F9E4";
  },
  get cardBorder() {
    const c = custom();
    return c ? mix(c, "#FFFFFF", 0.8) : "#E1E8D2";
  },
  get innerBorder() {
    return this.cardBorder;
  },
  get rule() {
    return this.cardBorder;
  },
  get innerFill() {
    const c = custom();
    return c ? mix(c, "#FFFFFF", 0.94) : "#F7FBEA";
  },
  get red() {
    return custom() ?? "#A3E635";
  },
  get redFg() {
    const c = custom();
    return c ? onColor(c) : "#141C08"; // text on the accent buttons
  },
  get deep() {
    const c = custom();
    return c ? textOnWhite(c) : "#4D7C0F"; // darker accent for small text on white
  },
};

/** The brand of an event's emails, from its settings map. */
export function emailBrand(settings: Record<string, string | undefined>): EmailBrand {
  return {
    name: settings.event_brand_name || BRAND_NAME,
    color: normalizeHex(settings.event_color) ?? DEFAULT_COLOR,
    logoUrl: settings.event_logo_url || LOGO_URL,
  };
}

/** Renders one email in an event's brand. Rendering is synchronous, so the brand cannot leak into another email. */
function withBrand<T>(brand: EmailBrand | undefined, render: () => T): T {
  active = brand ?? null;
  try {
    return render();
  } finally {
    active = null;
  }
}

/**
 * Public address of this app. Mail apps need full https:// links (not relative paths) for buttons,
 * so set APP_BASE_URL in the environment to the address this dashboard is served from.
 */
export function appBaseUrl(): string {
  const configured = process.env.APP_BASE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return (configured || "http://localhost:3000").replace(/\/+$/, "");
}

/** The logo at the top of every email (see src/lib/brand.ts). It is the dark logo, which suits the white card. */
export function emailLogoUrl(): string {
  return active?.logoUrl ?? LOGO_URL;
}

export function escapeHtml(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function paragraphsFromPlainText(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin:0 0 14px;color:${BRAND.muted};font-size:14.5px;line-height:1.6;font-family:Arial,sans-serif;">${escapeHtml(
          block
        ).replace(/\n/g, "<br/>")}</p>`
    )
    .join("");
}

function summaryRow(label: string, value: string | null | undefined): string {
  return `<tr>
    <td style="padding:6px 0;color:${BRAND.muted};">${escapeHtml(label)}</td>
    <td style="padding:6px 0;text-align:right;">${escapeHtml(value || "-")}</td>
  </tr>`;
}

export interface SummaryBlock {
  heading: string;
  rows: [string, string | null | undefined][];
}

function ctaButton(label?: string, url?: string): string {
  if (!label || !url) return "";
  return `<a href="${url}" style="display:inline-block;background:${BRAND.red};color:${BRAND.redFg};padding:14px 30px;border-radius:999px;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;">${escapeHtml(
    label
  )}</a>`;
}

function eyebrowPill(text: string): string {
  return `<span style="display:inline-block;border:1px solid ${BRAND.red};background:${BRAND.innerFill};color:${BRAND.deep};font-size:11px;font-weight:700;letter-spacing:0.08em;padding:6px 14px;border-radius:999px;font-family:Arial,sans-serif;">${escapeHtml(
    text
  )}</span>`;
}

/** Outer pale-green page, white bordered card, logo on top and the footer line at the bottom. */
function emailShell(inner: string, opts: { maxWidth: number; ctaHtml?: string }): string {
  return `<div style="background:${BRAND.pageBg};padding:40px 16px;font-family:Georgia,'Times New Roman',serif;">
    <div style="max-width:${opts.maxWidth}px;margin:0 auto;background:${BRAND.cardBg};border-radius:16px;overflow:hidden;border:1px solid ${BRAND.cardBorder};">
      <div style="padding:36px 40px 0;text-align:center;">
        <img src="${emailLogoUrl()}" alt="${escapeHtml(active?.name ?? BRAND_NAME)}" width="170" style="display:inline-block;width:170px;max-width:60%;height:auto;border:0;outline:none;text-decoration:none;" />
      </div>
      ${inner}
      <div style="padding:28px 40px 40px;text-align:center;">
        ${opts.ctaHtml ?? ""}
        <p style="margin:22px 0 0;color:${BRAND.footerMuted};font-size:11.5px;font-family:Arial,sans-serif;">© ${new Date().getFullYear()} ${escapeHtml(active?.name ?? BRAND_NAME)}. All rights reserved.</p>
      </div>
    </div>
  </div>`;
}

export interface BrandedEmailOptions {
  brand?: EmailBrand;
  eyebrow: string;
  heading: string;
  bodyText: string; // plain text, blank line = new paragraph
  summaryBlocks?: SummaryBlock[];
  ctaLabel?: string;
  ctaUrl?: string;
}

/** Wraps admin-edited plain-text copy in the Investor Hangout brand HTML shell. */
export function renderBrandedEmail(opts: BrandedEmailOptions): string {
  return withBrand(opts.brand, () => renderBrandedEmailInner(opts));
}

function renderBrandedEmailInner(opts: BrandedEmailOptions): string {
  const summaryHtml = (opts.summaryBlocks ?? [])
    .map(
      (block) => `
    <div style="margin:20px 40px 0;background:${BRAND.innerFill};border:1px solid ${BRAND.innerBorder};border-radius:12px;padding:22px 24px;font-family:Arial,sans-serif;">
      <div style="font-size:11px;letter-spacing:0.08em;color:${BRAND.muted};text-transform:uppercase;margin-bottom:14px;">${escapeHtml(
        block.heading
      )}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;color:${BRAND.fg};">
        ${block.rows.map(([label, value]) => summaryRow(label, value)).join("")}
      </table>
    </div>`
    )
    .join("");

  const inner = `
      <div style="padding:28px 40px 8px;text-align:center;">
        ${eyebrowPill(opts.eyebrow)}
        <h1 style="margin:22px 0 0;color:${BRAND.fg};font-size:26px;line-height:1.3;font-weight:600;">${escapeHtml(opts.heading)}</h1>
        <div style="margin-top:16px;text-align:left;">${paragraphsFromPlainText(opts.bodyText)}</div>
      </div>
      ${summaryHtml}`;

  return emailShell(inner, { maxWidth: 560, ctaHtml: ctaButton(opts.ctaLabel, opts.ctaUrl) });
}

// ---------------------------------------------------------------------------
// Payment receipt (invoice style)
// ---------------------------------------------------------------------------

export interface ReceiptLine {
  date: string;
  method: string;
  /** exact amount paid, in the currency it was paid in, e.g. "₦2,800,000 (NGN)" */
  paid: string;
  /** e.g. "1 USD = 1,400 NGN", or "-" for USD payments */
  rate: string;
  /** USD equivalent, e.g. "USD 2,000.00" */
  usd: string;
}

export interface ReceiptOptions {
  brand?: EmailBrand;
  eyebrow: string;
  heading: string;
  intro: string; // plain text, blank line = new paragraph
  receiptNo: string;
  issuedOn: string;
  paidInFull: boolean;
  billedTo: { name: string; email: string; phone?: string | null; country?: string | null };
  forWhat: { programme: string; registrationType: string; dates?: string | null };
  lines: ReceiptLine[];
  totals: { fee: string | null; paid: string; balance: string | null };
  footnote?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

function receiptMeta(label: string, value: string): string {
  return `<div style="display:inline-block;vertical-align:top;margin:0 24px 10px 0;">
    <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.muted};margin-bottom:4px;">${escapeHtml(label)}</div>
    <div style="font-size:14px;color:${BRAND.fg};font-weight:600;">${escapeHtml(value)}</div>
  </div>`;
}

function receiptBlock(label: string, values: (string | null | undefined)[]): string {
  const lines = values
    .filter((v): v is string => Boolean(v && String(v).trim()))
    .map(
      (v, i) =>
        `<div style="${i === 0 ? `color:${BRAND.fg};font-weight:600;` : `color:${BRAND.muted};`}font-size:13.5px;line-height:1.6;word-break:break-word;">${escapeHtml(v)}</div>`
    )
    .join("");
  return `<div style="display:inline-block;vertical-align:top;width:48%;min-width:200px;margin:0 0 14px 0;">
    <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.muted};margin-bottom:8px;">${escapeHtml(label)}</div>
    ${lines}
  </div>`;
}

/**
 * Invoice-style payment receipt: who paid, what for, each payment in the
 * currency it was paid in with its USD equivalent, and the totals. Built so it
 * stacks cleanly on a phone (no wide multi-column table).
 */
export function renderReceiptEmail(opts: ReceiptOptions): string {
  return withBrand(opts.brand, () => renderReceiptEmailInner(opts));
}

function renderReceiptEmailInner(opts: ReceiptOptions): string {
  const statusLabel = opts.paidInFull ? "Paid in full" : "Part payment";
  const statusBadge = `<span style="display:inline-block;border:1px solid ${BRAND.red};background:${opts.paidInFull ? BRAND.red : "transparent"};color:${
    opts.paidInFull ? BRAND.redFg : BRAND.fg
  };font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:6px 14px;border-radius:999px;white-space:nowrap;">${statusLabel}</span>`;

  const paymentRows = opts.lines
    .map((l) => {
      const showRate = l.rate && l.rate !== "-";
      return `<tr>
        <td style="padding:14px 0;border-top:1px solid ${BRAND.rule};vertical-align:top;">
          <div style="color:${BRAND.fg};font-size:13.5px;">${escapeHtml(l.date)}</div>
          <div style="color:${BRAND.muted};font-size:12px;margin-top:2px;">${escapeHtml(l.method)}</div>
          ${showRate ? `<div style="color:${BRAND.muted};font-size:12px;margin-top:2px;">Rate: ${escapeHtml(l.rate)}</div>` : ""}
        </td>
        <td style="padding:14px 0;border-top:1px solid ${BRAND.rule};vertical-align:top;text-align:right;">
          <div style="color:${BRAND.fg};font-size:14px;font-weight:700;">${escapeHtml(l.paid)}</div>
          ${showRate ? `<div style="color:${BRAND.muted};font-size:12px;margin-top:2px;">equals</div><div style="color:${BRAND.fg};font-size:13.5px;margin-top:2px;">${escapeHtml(l.usd)}</div>` : ""}
        </td>
      </tr>`;
    })
    .join("");

  const totalRow = (label: string, value: string, strong = false) => `<tr>
      <td style="padding:8px 0;color:${strong ? BRAND.fg : BRAND.muted};font-size:${strong ? 15 : 13.5}px;${strong ? "font-weight:700;" : ""}">${escapeHtml(label)}</td>
      <td style="padding:8px 0;text-align:right;color:${BRAND.fg};font-size:${strong ? 18 : 13.5}px;${strong ? "font-weight:700;" : ""}">${escapeHtml(value)}</td>
    </tr>`;

  const inner = `
      <div style="padding:28px 24px 0;text-align:center;">
        ${eyebrowPill(opts.eyebrow)}
        <h1 style="margin:22px 0 0;color:${BRAND.fg};font-size:26px;line-height:1.3;font-weight:600;">${escapeHtml(opts.heading)}</h1>
        <div style="margin-top:16px;text-align:left;">${paragraphsFromPlainText(opts.intro)}</div>
      </div>

      <div style="margin:20px 16px 0;background:${BRAND.innerFill};border:1px solid ${BRAND.innerBorder};border-radius:12px;font-family:Arial,sans-serif;">
        <div style="padding:18px 20px 8px;border-bottom:1px solid ${BRAND.rule};">
          ${receiptMeta("Receipt no.", opts.receiptNo)}${receiptMeta("Date issued", opts.issuedOn)}<div style="display:inline-block;vertical-align:top;margin:0 0 10px 0;">${statusBadge}</div>
        </div>

        <div style="padding:18px 20px 4px;border-bottom:1px solid ${BRAND.rule};">
          ${receiptBlock("Billed to", [opts.billedTo.name, opts.billedTo.email, opts.billedTo.phone, opts.billedTo.country])}${receiptBlock("For", [
            opts.forWhat.programme,
            `Registration: ${opts.forWhat.registrationType}`,
            opts.forWhat.dates,
          ])}
        </div>

        <div style="padding:18px 20px 0;">
          <div style="font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.muted};margin-bottom:4px;">Payments received</div>
          <table style="width:100%;border-collapse:collapse;margin-top:6px;"><tbody>${paymentRows}</tbody></table>
        </div>

        <div style="padding:6px 20px 20px;">
          <table style="width:100%;border-collapse:collapse;border-top:1px solid ${BRAND.rule};">
            ${opts.totals.fee ? totalRow("Registration fee", opts.totals.fee) : ""}
            <tr><td colspan="2" style="height:0;padding:0;border-top:2px solid ${BRAND.red};font-size:0;line-height:0;">&nbsp;</td></tr>
            ${totalRow("Total paid", opts.totals.paid, true)}
            ${opts.totals.balance ? totalRow("Balance due", opts.totals.balance) : ""}
          </table>
        </div>
      </div>
      ${
        opts.footnote
          ? `<p style="margin:16px 24px 0;color:${BRAND.footerMuted};font-size:11.5px;line-height:1.6;font-family:Arial,sans-serif;text-align:left;">${escapeHtml(opts.footnote)}</p>`
          : ""
      }`;

  return emailShell(inner, { maxWidth: 620, ctaHtml: ctaButton(opts.ctaLabel, opts.ctaUrl) });
}

// ---------------------------------------------------------------------------
// Entry ticket
// ---------------------------------------------------------------------------

export interface TicketEmailOptions {
  brand?: EmailBrand;
  eventName: string;
  guestName: string;
  ticketCode: string;
  date: string;
  time: string;
  venue: string;
  intro: string; // plain text, blank line = new paragraph
  contactLine?: string;
  /** The QR image is attached to the email with this content id. */
  qrCid: string;
}

function ticketField(label: string, value: string): string {
  return `<div style="font-size:10.5px;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.muted};font-family:Arial,sans-serif;margin-bottom:5px;">${escapeHtml(
    label
  )}</div>
  <div style="font-size:16px;line-height:1.35;color:${BRAND.fg};font-weight:700;font-family:Arial,sans-serif;">${escapeHtml(value || "To be announced")}</div>`;
}

/**
 * The entry ticket: lemon-green header band, guest name, date / time / venue, a dashed tear-off line and a
 * stub with the QR code and ticket code. Built from tables and inline styles so it renders in Gmail, Outlook
 * and phone mail apps. The QR image is attached to the email (cid) instead of linked, so it shows even when
 * remote images are blocked.
 */
export function renderTicketEmail(opts: TicketEmailOptions): string {
  return withBrand(opts.brand, () => renderTicketEmailInner(opts));
}

function renderTicketEmailInner(opts: TicketEmailOptions): string {
  const inner = `
      <div style="padding:28px 40px 4px;text-align:center;">
        ${eyebrowPill("Your ticket")}
        <h1 style="margin:20px 0 0;color:${BRAND.fg};font-size:26px;line-height:1.3;font-weight:600;">Your seat is reserved</h1>
        <div style="margin-top:14px;text-align:left;">${paragraphsFromPlainText(opts.intro)}</div>
      </div>

      <div style="margin:18px 24px 0;border:2px solid ${BRAND.red};border-radius:16px;overflow:hidden;background:${BRAND.cardBg};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="background:${BRAND.red};padding:14px 22px;font-family:Arial,sans-serif;">
              <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${BRAND.redFg};font-weight:700;">Admit one &middot; By invitation</div>
              <div style="font-size:19px;line-height:1.3;color:${BRAND.redFg};font-weight:800;margin-top:4px;">${escapeHtml(opts.eventName)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 22px 6px;">
              ${ticketField("Guest", opts.guestName)}
            </td>
          </tr>
          <tr>
            <td style="padding:12px 22px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td valign="top" width="50%" style="padding:0 10px 14px 0;">${ticketField("Date", opts.date)}</td>
                  <td valign="top" width="50%" style="padding:0 0 14px 10px;">${ticketField("Time", opts.time)}</td>
                </tr>
                <tr>
                  <td valign="top" colspan="2" style="padding:0 0 8px 0;">${ticketField("Venue", opts.venue)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 14px;"><div style="border-top:2px dashed #C9D6A8;font-size:0;line-height:0;">&nbsp;</div></td>
          </tr>
          <tr>
            <td style="padding:18px 22px 22px;background:${BRAND.innerFill};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td valign="middle" width="150" style="width:150px;">
                    <img src="cid:${opts.qrCid}" alt="QR code for ticket ${escapeHtml(opts.ticketCode)}" width="140" height="140" style="display:block;width:140px;height:140px;border:0;background:#FFFFFF;border-radius:8px;" />
                  </td>
                  <td valign="middle" style="padding-left:18px;font-family:Arial,sans-serif;">
                    <div style="font-size:10.5px;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.muted};margin-bottom:6px;">Ticket code</div>
                    <div style="font-family:'Courier New',Courier,monospace;font-size:24px;letter-spacing:0.08em;color:${BRAND.fg};font-weight:700;">${escapeHtml(opts.ticketCode)}</div>
                    <div style="font-size:12.5px;line-height:1.5;color:${BRAND.muted};margin-top:10px;">Show this ticket at the entrance. The QR code is scanned to check you in.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>

      <div style="padding:20px 40px 0;text-align:left;">
        ${paragraphsFromPlainText(
          `Please show this email (or a screenshot or printout of it) at the entrance. Entry is strictly by invitation and each ticket admits one person.${
            opts.contactLine ? `\n\n${opts.contactLine}` : ""
          }`
        )}
      </div>`;

  return emailShell(inner, { maxWidth: 560 });
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * kind decides the channel:
 *   "campaign"  -> Brevo (broadcast email, with delivery/open/bounce tracking)
 *   anything else -> Gmail (invitation, reminder, ticket, internal and the older registration emails)
 */
export type EmailKind =
  | "invitation"
  | "reminder"
  | "ticket"
  | "confirmation"
  | "brochure"
  | "seat_invite"
  | "payment_reminder"
  | "payment_confirmation"
  | "pay_later_ack"
  | "pay_later_reminder"
  | "seat_confirmation"
  | "online_confirmation"
  | "internal"
  | "campaign";

export interface SendEmailInput {
  kind: EmailKind;
  to: string;
  subject: string;
  html: string;
  replyTo?: string | null;
  tags?: { name: string; value: string }[];
  /** Inline images (Gmail channel only), referenced in the html as <img src="cid:...">. */
  attachments?: GmailAttachment[];
}

export type EmailProvider = "GMAIL" | "BREVO" | "MAILERSEND";

export interface SendEmailResult {
  success: boolean;
  provider?: EmailProvider;
  providerMessageId?: string;
  error?: string;
  /** Every sender in the pool has used its daily limit. Nothing was sent and nothing failed: the email waits for tomorrow. */
  deferred?: boolean;
}

/** True for "a@b.co" or "Name <a@b.co>" — the two shapes accepted for from / reply-to. */
export function isValidEmailAddress(value: string): boolean {
  const v = value.trim();
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v) || /^[^<>]*<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$/.test(v);
}

/** Splits "Name <a@b.co>" or "a@b.co" into the { name, email } shape Brevo expects. */
function parseAddress(value: string): { name?: string; email: string } {
  const v = value.trim();
  const match = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].trim();
    return name ? { name, email: match[2].trim() } : { email: match[2].trim() };
  }
  return { email: v };
}

/** Brevo errors arrive as JSON like {"code":"invalid_parameter","message":"..."} — pull out the readable part. */
function describeBrevoError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string; code?: string };
    if (parsed.message) return `Brevo ${status}${parsed.code ? ` (${parsed.code})` : ""}: ${parsed.message}`;
  } catch {
    // not JSON — fall through to the raw body
  }
  return `Brevo ${status}: ${body.slice(0, 300)}`;
}

/**
 * Sends via Brevo's transactional email API (used for campaigns/broadcasts only).
 * In production a missing BREVO_API_KEY is a hard failure (so the dashboard shows
 * "Failed" with the reason, rather than a fake "Sent"). Outside production it logs
 * the email to the console instead, so local development works without credentials.
 *
 * The sender in EMAIL_FROM must be a sender/domain you have verified in Brevo.
 */
export async function sendViaBrevo(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.BREVO_API_KEY;
  // EMAIL_FROM must be a sender/domain verified in Brevo. Without it, fall back to the Gmail account's address.
  const from = process.env.EMAIL_FROM || (process.env.GMAIL_USER ? `${BRAND_NAME} <${process.env.GMAIL_USER}>` : "");

  if (!from) {
    return { success: false, provider: "BREVO", error: "EMAIL_FROM is not set on the server (a sender address verified in Brevo)." };
  }

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      console.error("[email] BREVO_API_KEY is not set in this deployment — email not sent.");
      return { success: false, provider: "BREVO", error: "BREVO_API_KEY is not set on the server." };
    }
    console.warn(
      `[email:dev-mode] BREVO_API_KEY not set — logging email instead of sending.\nTo: ${input.to}\nSubject: ${input.subject}`
    );
    return { success: true, provider: "BREVO", providerMessageId: undefined };
  }

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: parseAddress(from),
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent: input.html,
        replyTo: input.replyTo ? parseAddress(input.replyTo) : undefined,
        // Brevo tags are plain strings; the webhook reads them back as "name:value".
        tags: input.tags?.map((t) => `${t.name}:${t.value}`),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[email] Brevo send failed:", response.status, errText);
      return { success: false, provider: "BREVO", error: describeBrevoError(response.status, errText) };
    }

    const data = (await response.json()) as { messageId?: string };
    return { success: true, provider: "BREVO", providerMessageId: data.messageId };
  } catch (err) {
    console.error("[email] Brevo request threw:", err);
    return { success: false, provider: "BREVO", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sends via the Gmail / Google Workspace account in GMAIL_USER and maps the result to SendEmailResult. */
export async function sendViaGmailChannel(input: SendEmailInput): Promise<SendEmailResult> {
  const res = await sendViaGmail({
    to: input.to,
    subject: input.subject,
    html: input.html,
    replyTo: input.replyTo || undefined,
    attachments: input.attachments,
  });
  return res.ok
    ? { success: true, provider: "GMAIL", providerMessageId: res.id }
    : { success: false, provider: "GMAIL", error: res.error || "Gmail send failed." };
}

/**
 * Sends via MailerSend's email API. Needs MAILERSEND_API_KEY and MAILERSEND_FROM (an address on a domain verified in MailerSend).
 * Delivery and open tracking are not wired up for this sender yet, so those emails show as Sent only.
 */
export async function sendViaMailerSend(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.MAILERSEND_API_KEY;
  const from = process.env.MAILERSEND_FROM || process.env.EMAIL_FROM || "";
  if (!apiKey) return { success: false, provider: "MAILERSEND", error: "MAILERSEND_API_KEY is not set on the server." };
  if (!from) return { success: false, provider: "MAILERSEND", error: "MAILERSEND_FROM is not set on the server (an address on a domain verified in MailerSend)." };
  const sender = parseAddress(from);
  const reply = input.replyTo ? parseAddress(input.replyTo) : null;
  try {
    const response = await fetch("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify({
        from: { email: sender.email, ...(sender.name ? { name: sender.name } : {}) },
        to: [{ email: input.to }],
        subject: input.subject,
        html: input.html,
        ...(reply ? { reply_to: { email: reply.email, ...(reply.name ? { name: reply.name } : {}) } } : {}),
      }),
    });
    if (response.status === 202 || response.ok) return { success: true, provider: "MAILERSEND", providerMessageId: response.headers.get("x-message-id") ?? undefined };
    const text = await response.text();
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (parsed.message) message = parsed.message;
    } catch {
      // not JSON
    }
    return { success: false, provider: "MAILERSEND", error: `MailerSend ${response.status}: ${message}` };
  } catch (err) {
    return { success: false, provider: "MAILERSEND", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Routes one email to a sender.
 * - When the sender pool has been set up (src/lib/senders.ts), the pool decides: senders in order, each with a daily limit.
 * - Otherwise, as before: campaigns go through Brevo, everything else through Gmail.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { sendThroughPool } = await import("@/lib/senders");
  const pooled = await sendThroughPool(input);
  if (pooled) return pooled;
  if (input.kind === "campaign") return sendViaBrevo(input);
  return sendViaGmailChannel(input);
}
