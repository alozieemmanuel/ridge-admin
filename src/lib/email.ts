import { sendViaGmail } from "./gmail";

// Brand palette: black, grey, white and red. Change here to restyle every
// email sent to participants. Solid hex values only (no rgba) so it also
// renders correctly in Outlook and other older mail apps.
const BRAND = {
  pageBg: "#000000",
  cardBg: "#000000",
  cardBorder: "#404040",
  innerBorder: "#404040",
  innerFill: "#0F0F0F",
  fg: "#FEFEFE",
  muted: "#ADADAD",
  footerMuted: "#8C8C8C",
  red: "#EB3C34",
  redFg: "#000000", // text on red buttons
  rule: "#404040",
};

/**
 * Public address of this app, used for the logo in emails (mail apps need a
 * full https:// link, not a relative path). The logo file is
 * /public/ridge-logo-email.png (a small white version made for email). Set APP_BASE_URL in the environment
 * if the dashboard is served from a different address.
 */
export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || "https://admin.theridgecircle.com").replace(/\/+$/, "");
}

export function emailLogoUrl(): string {
  // A small (540px wide, about 30 KB) copy made for email. The full-size logo used
  // on the dashboard is far too heavy for mail apps to fetch quickly.
  return `${appBaseUrl()}/ridge-logo-email.png`;
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
  return `<span style="display:inline-block;border:1px solid ${BRAND.red};color:${BRAND.fg};font-size:11px;letter-spacing:0.08em;padding:6px 14px;border-radius:999px;font-family:Arial,sans-serif;">${escapeHtml(
    text
  )}</span>`;
}

/** Outer black page, bordered card, white RIDGE logo on top and the footer line at the bottom. */
function emailShell(inner: string, opts: { maxWidth: number; ctaHtml?: string }): string {
  return `<div style="background:${BRAND.pageBg};padding:40px 16px;font-family:Georgia,'Times New Roman',serif;">
    <div style="max-width:${opts.maxWidth}px;margin:0 auto;background:${BRAND.cardBg};border-radius:16px;overflow:hidden;border:1px solid ${BRAND.cardBorder};">
      <div style="padding:36px 40px 0;text-align:center;">
        <img src="${emailLogoUrl()}" alt="RIDGE" width="180" height="42" style="display:inline-block;width:180px;max-width:70%;height:auto;border:0;outline:none;text-decoration:none;" />
      </div>
      ${inner}
      <div style="padding:28px 40px 40px;text-align:center;">
        ${opts.ctaHtml ?? ""}
        <p style="margin:22px 0 0;color:${BRAND.footerMuted};font-size:11.5px;font-family:Arial,sans-serif;">© 2026 RIDGE. All rights reserved.</p>
      </div>
    </div>
  </div>`;
}

export interface BrandedEmailOptions {
  eyebrow: string;
  heading: string;
  bodyText: string; // plain text, blank line = new paragraph
  summaryBlocks?: SummaryBlock[];
  ctaLabel?: string;
  ctaUrl?: string;
}

/** Wraps admin-edited plain-text copy in the RIDGE brand HTML shell. */
export function renderBrandedEmail(opts: BrandedEmailOptions): string {
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
// Sending
// ---------------------------------------------------------------------------

/**
 * kind decides the channel:
 *   "campaign"  -> Brevo (broadcast email, with delivery/open/bounce tracking)
 *   anything else -> Gmail (confirmation, payment_reminder, seat_invite, internal, brochure)
 */
export type EmailKind =
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
}

export type EmailProvider = "GMAIL" | "BREVO";

export interface SendEmailResult {
  success: boolean;
  provider?: EmailProvider;
  providerMessageId?: string;
  error?: string;
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
async function sendViaBrevo(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.EMAIL_FROM || "RIDGE 2026 <ridge@pertinencegroup.com>";

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

/** Sends via Google Workspace (ridge@pertinencegroup.com) and maps the result to SendEmailResult. */
async function sendViaGmailChannel(input: SendEmailInput): Promise<SendEmailResult> {
  const res = await sendViaGmail({
    to: input.to,
    subject: input.subject,
    html: input.html,
    replyTo: input.replyTo || undefined,
  });
  return res.ok
    ? { success: true, provider: "GMAIL", providerMessageId: res.id }
    : { success: false, provider: "GMAIL", error: res.error || "Gmail send failed." };
}

/**
 * Routes one email to the right channel.
 * - campaign -> Brevo only.
 * - everything else -> Gmail only. There is no fallback to Brevo: Brevo is
 *   reserved for broadcasts.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (input.kind === "campaign") {
    return sendViaBrevo(input);
  }
  return sendViaGmailChannel(input);
}
