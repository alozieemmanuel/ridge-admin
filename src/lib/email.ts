import { sendViaGmail } from "./gmail";

// Brand palette — matches the black-and-gold executive theme from the
// original index.html / register.html. Change here to restyle every email.
const BRAND = {
  pageBg: "#120E0B",
  cardBg: "#17130E",
  cardBorder: "rgba(201, 151, 46, 0.18)",
  innerBorder: "rgba(247, 242, 231, 0.12)",
  innerFill: "rgba(247, 242, 231, 0.05)",
  fg: "#F7F2E7",
  muted: "#B8AE9C",
  footerMuted: "#8A806E",
  gold: "#C9972E",
  goldLight: "#F1C866",
  goldGradient: "linear-gradient(135deg, #F1C866, #C9972E 55%, #9C7220)",
  goldFg: "#17130E",
};

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

  const ctaHtml =
    opts.ctaLabel && opts.ctaUrl
      ? `<a href="${opts.ctaUrl}" style="display:inline-block;background:${BRAND.goldGradient};color:${BRAND.goldFg};padding:14px 30px;border-radius:999px;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;">${escapeHtml(
          opts.ctaLabel
        )}</a>`
      : "";

  return `<div style="background:${BRAND.pageBg};padding:40px 16px;font-family:Georgia,'Times New Roman',serif;">
    <div style="max-width:560px;margin:0 auto;background:${BRAND.cardBg};border-radius:16px;overflow:hidden;border:1px solid ${BRAND.cardBorder};">
      <div style="padding:36px 40px 0;text-align:center;">
        <span style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:${BRAND.fg};letter-spacing:0.02em;">RIDGE<span style="color:${BRAND.gold};">.</span></span>
      </div>
      <div style="padding:28px 40px 8px;text-align:center;">
        <span style="display:inline-block;border:1px solid rgba(201, 151, 46, 0.35);color:${BRAND.goldLight};font-size:11px;letter-spacing:0.08em;padding:6px 14px;border-radius:999px;font-family:Arial,sans-serif;">${escapeHtml(
          opts.eyebrow
        )}</span>
        <h1 style="margin:22px 0 0;color:${BRAND.fg};font-size:26px;line-height:1.3;font-weight:600;">${escapeHtml(
          opts.heading
        )}</h1>
        <div style="margin-top:16px;text-align:left;">${paragraphsFromPlainText(opts.bodyText)}</div>
      </div>
      ${summaryHtml}
      <div style="padding:28px 40px 40px;text-align:center;">
        ${ctaHtml}
        <p style="margin:22px 0 0;color:${BRAND.footerMuted};font-size:11.5px;font-family:Arial,sans-serif;">© 2026 RIDGE. All rights reserved.</p>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * kind decides the channel:
 *   "campaign"  -> Resend (bulk, with delivery/open/bounce tracking)
 *   anything else -> Gmail (confirmation, payment_reminder, seat_invite, internal, brochure)
 */
export type EmailKind =
  | "confirmation"
  | "brochure"
  | "seat_invite"
  | "payment_reminder"
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

export interface SendEmailResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

/** True for "a@b.co" or "Name <a@b.co>" — the two shapes Resend accepts for from / reply_to. */
export function isValidEmailAddress(value: string): boolean {
  const v = value.trim();
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v) || /^[^<>]*<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$/.test(v);
}

/** Resend errors arrive as JSON like {"name":"validation_error","message":"..."} — pull out the readable part. */
function describeResendError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string; name?: string };
    if (parsed.message) return `Resend ${status}${parsed.name ? ` (${parsed.name})` : ""}: ${parsed.message}`;
  } catch {
    // not JSON — fall through to the raw body
  }
  return `Resend ${status}: ${body.slice(0, 300)}`;
}

/**
 * Sends via Resend. In production a missing RESEND_API_KEY is a hard failure
 * (so the dashboard shows "Failed" with the reason, rather than a fake "Sent").
 * Outside production it logs the email to the console instead, so local
 * development works without live email credentials.
 */
async function sendViaResend(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "RIDGE 2026 <onboarding@resend.dev>";

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      console.error("[email] RESEND_API_KEY is not set in this deployment — email not sent.");
      return { success: false, error: "RESEND_API_KEY is not set on the server." };
    }
    console.warn(
      `[email:dev-mode] RESEND_API_KEY not set — logging email instead of sending.\nTo: ${input.to}\nSubject: ${input.subject}`
    );
    return { success: true, providerMessageId: undefined };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        reply_to: input.replyTo || undefined,
        tags: input.tags,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[email] Resend send failed:", response.status, errText);
      return { success: false, error: describeResendError(response.status, errText) };
    }

    const data = (await response.json()) as { id?: string };
    return { success: true, providerMessageId: data.id };
  } catch (err) {
    console.error("[email] Resend request threw:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
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
    ? { success: true, providerMessageId: res.id }
    : { success: false, error: res.error || "Gmail send failed." };
}

/**
 * Routes one email to the right channel.
 * - campaign -> Resend only.
 * - everything else -> Gmail. If Gmail fails, falls back to Resend so the
 *   person still gets the email. Set EMAIL_GMAIL_FALLBACK=false to disable.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (input.kind === "campaign") {
    return sendViaResend(input);
  }

  const gmailResult = await sendViaGmailChannel(input);
  if (gmailResult.success) return gmailResult;

  const fallbackEnabled = process.env.EMAIL_GMAIL_FALLBACK !== "false";
  if (!fallbackEnabled) return gmailResult;

  console.warn(`[email] Gmail failed (${gmailResult.error}). Falling back to Resend.`);
  const resendResult = await sendViaResend(input);
  if (resendResult.success) return resendResult;

  return {
    success: false,
    error: `Gmail: ${gmailResult.error} | Resend: ${resendResult.error}`,
  };
}