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
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
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
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gmail] Send failed:", message);
    return { ok: false, error: message };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}