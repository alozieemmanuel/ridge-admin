import nodemailer, { type Transporter } from "nodemailer";

/** An image (or file) sent with the email. Give it a `cid` to use it inline as <img src="cid:...">. */
export type GmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
  cid?: string;
};

export type GmailSendInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** Overrides GMAIL_FROM_NAME: the name guests see as the sender. */
  fromName?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: GmailAttachment[];
};

export type GmailSendResult = {
  ok: boolean;
  id?: string;
  error?: string;
};

const transporters = new Map<number, Transporter>();
const NETWORK_CODES = ["ETIMEDOUT", "ECONNREFUSED", "ECONNECTION", "ESOCKET", "ENETUNREACH", "EHOSTUNREACH", "ECONNRESET"];

function isNetworkError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? "";
  return NETWORK_CODES.includes(code);
}

function getTransporter(portOverride?: number): Transporter | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;

  // Port 465 (secure from the start) is the default. GMAIL_SMTP_PORT=587 switches to the other standard Gmail port (STARTTLS).
  // When the first port can't be reached at all, a send is retried once on the other one (some networks block one of them).
  const port = portOverride ?? (Number(process.env.GMAIL_SMTP_PORT) === 587 ? 587 : 465);
  let transporter = transporters.get(port);
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: { user, pass },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      // Gmail slows down a lot as the daily limit gets close, so give it room before calling a send failed.
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 60_000,
    });
    transporters.set(port, transporter);
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
  const fromName = (input.fromName || process.env.GMAIL_FROM_NAME || "Investor Hangout").replace(/["<>\r\n]/g, "").trim();

  const message = {
    from: `"${fromName}" <${user}>`,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    replyTo: input.replyTo || user,
    subject: input.subject,
    html: input.html,
    text: input.text || stripHtml(input.html),
    attachments: input.attachments,
  };

  try {
    try {
      const info = await t.sendMail(message);
      return { ok: true, id: info.messageId };
    } catch (first) {
      if (!isNetworkError(first)) throw first;
      const configured = Number(process.env.GMAIL_SMTP_PORT) === 587 ? 587 : 465;
      const other = getTransporter(configured === 587 ? 465 : 587);
      if (!other) throw first;
      console.warn(`[gmail] Port ${configured} unreachable, retrying on ${configured === 587 ? 465 : 587}.`);
      const info = await other.sendMail(message);
      return { ok: true, id: info.messageId };
    }
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
    return "Couldn't reach Gmail's mail server. Your network, firewall or antivirus may be blocking it (both Gmail ports, 465 and 587, were tried), or the internet connection is down.";
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