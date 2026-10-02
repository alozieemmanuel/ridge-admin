import nodemailer, { type Transporter } from "nodemailer";

export type GmailSendInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
};

export type GmailSendResult = {
  ok: boolean;
  id?: string;
  error?: string;
};

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;

  if (!transporter) {
    // Port 465 (secure from the start) is the default. If a network blocks 465,
    // set GMAIL_SMTP_PORT=587 to use the other standard Gmail port (STARTTLS).
    const port = Number(process.env.GMAIL_SMTP_PORT) === 587 ? 587 : 465;
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: { user, pass },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      // Fail in seconds, not half a minute, when Gmail can't be reached.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }
  return transporter;
}

export function isGmailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export async function sendViaGmail(
  input: GmailSendInput
): Promise<GmailSendResult> {
  const t = getTransporter();

  if (!t) {
    console.log("[gmail] Not configured. Email logged instead of sent.");
    console.log(`[gmail] To: ${JSON.stringify(input.to)} | Subject: ${input.subject}`);
    return { ok: false, error: "gmail_not_configured" };
  }

  const user = process.env.GMAIL_USER as string;
  const fromName = process.env.GMAIL_FROM_NAME || "RIDGE";

  try {
    const info = await t.sendMail({
      from: `"${fromName}" <${user}>`,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      replyTo: input.replyTo || user,
      subject: input.subject,
      html: input.html,
      text: input.text || stripHtml(input.html),
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[gmail] Send failed:", raw);
    return { ok: false, error: friendlyGmailError(err, raw) };
  }
}

/** Turns low-level network errors into something an admin can act on. */
function friendlyGmailError(err: unknown, raw: string): string {
  const code = (err as { code?: string } | null)?.code ?? "";
  if (["ETIMEDOUT", "ECONNREFUSED", "ECONNECTION", "ESOCKET", "ENETUNREACH", "EHOSTUNREACH", "ECONNRESET"].includes(code) || /ETIMEDOUT|ECONNREFUSED/.test(raw)) {
    return "Couldn't reach Gmail's mail server. Your network, firewall or antivirus may be blocking it (try GMAIL_SMTP_PORT=587), or the internet connection is down.";
  }
  if (code === "ENOTFOUND" || /ENOTFOUND/.test(raw)) {
    return "Couldn't find Gmail's mail server. Please check the internet connection.";
  }
  if (code === "EAUTH" || /Invalid login|Username and Password not accepted/i.test(raw)) {
    return "Gmail rejected the login. Check GMAIL_USER and that GMAIL_APP_PASSWORD is a valid app password.";
  }
  return raw;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}