/** Short, plain wording for a sending problem. The full text stays available on hover. */
export function summarizeSendError(raw: string | null | undefined): string {
  const t = (raw || "").toLowerCase();
  if (!t) return "";
  if (/daily user sending limit|sending limit|quota|limit exceed|exceeded|too many|rate/.test(t)) return "Daily limit reached. It resets at midnight.";
  if (/valid sender|sender email|not verified|unverified|from address|not an email/.test(t)) return "The from address is not set up correctly.";
  if (/auth|credential|login|api key|unauthor|forbidden|\b(401|403)\b/.test(t)) return "The login or key was refused.";
  if (/activat|suspend|disabled|blocked/.test(t)) return "The account is not active for sending.";
  if (/timeout|timed out|network|econn|enotfound|reach/.test(t)) return "Could not connect. Try again shortly.";
  if (/not set|not configured/.test(t)) return "Not set up on the server.";
  return "Could not send. Hover for details.";
}

/** "Gmail: paused (long text) | Brevo: paused (long text)" becomes "Gmail: daily limit reached. | Brevo: ...". */
export function summarizeBlocked(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .split("|")
    .map((part) => {
      const i = part.indexOf(":");
      if (i < 0) return summarizeSendError(part) || part.trim();
      const name = part.slice(0, i).trim();
      const rest = part.slice(i + 1).trim();
      if (/^not set up/i.test(rest)) return `${name}: not set up`;
      return `${name}: ${summarizeSendError(rest) || rest}`;
    })
    .join(" | ");
}
