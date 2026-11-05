/**
 * Finds email addresses that cannot be delivered (or are almost certainly typos) and, where it can, says what the address
 * probably should be. Used by the Check emails page so wrong addresses can be fixed before a campaign is sent.
 */

export interface EmailProblem {
  message: string;
  /** A corrected address to offer, or null when it cannot be guessed. */
  suggestion: string | null;
}

const COMMON_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com", "ymail.com", "rocketmail.com", "yahoo.co.uk", "googlemail.com", "aol.com", "proton.me", "protonmail.com"];

// Endings that are a mistyped ".com" (they are not real top-level domains in practice).
const BAD_TLD_FIX: Record<string, string> = { con: "com", cim: "com", comm: "com", coom: "com", vom: "com", ocm: "com", cmo: "com", c0m: "com", xom: "com", cpm: "com", comn: "com", comk: "com", clm: "com", cok: "com", om: "com", gom: "com", ney: "net", nte: "net", ent: "net", rg: "org", ogr: "org" };

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

const LOCAL_OK = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const LABEL_OK = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Returns null when the address looks fine. */
export function emailProblem(raw: string): EmailProblem | null {
  const original = raw ?? "";
  let e = original.trim().toLowerCase();
  if (!e) return { message: "No email address.", suggestion: null };

  // Two addresses in one box, or a separator typed instead of a dot.
  const many = e.split(/[\s,;]+/).filter((p) => p.includes("@"));
  if (many.length > 1) return { message: "More than one address in the box.", suggestion: many[0] };
  if (/\s/.test(e)) {
    const fixed = e.replace(/\s+/g, "");
    return { message: "The address has a space in it.", suggestion: emailProblem(fixed) ? null : fixed };
  }
  e = e.replace(/^[.,;:'"<>()]+|[.,;:'"<>()]+$/g, "");
  const trimmed = e !== original.trim().toLowerCase();

  const at = e.split("@");
  if (at.length !== 2) return { message: at.length < 2 ? "There is no @ in the address." : "There is more than one @ in the address.", suggestion: null };
  const [local, domainRaw] = at;
  let domain = domainRaw.replace(/,/g, ".");
  const commaFixed = domain !== domainRaw;
  if (!local || !domain) return { message: "Part of the address is missing before or after the @.", suggestion: null };

  if (local.length > 64 || !LOCAL_OK.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    const cleaned = local.replace(/\.{2,}/g, ".").replace(/^\.+|\.+$/g, "");
    const ok = cleaned && LOCAL_OK.test(cleaned) && cleaned.length <= 64;
    return { message: "The part before the @ has a character or dot that is not allowed.", suggestion: ok ? `${cleaned}@${domain}` : null };
  }

  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((l) => !l)) {
    return { message: domain.includes(".") ? "The part after the @ has a stray or double dot." : "The part after the @ has no ending such as .com.", suggestion: domain.includes(".") ? `${local}@${labels.filter(Boolean).join(".")}` : null };
  }
  if (labels.some((l) => !LABEL_OK.test(l) && !l.startsWith("xn--"))) return { message: "The part after the @ has a character that is not allowed.", suggestion: null };

  // A mistyped ending such as .cim, .con or .comm.
  const tld = labels[labels.length - 1];
  const fixTld = BAD_TLD_FIX[tld];
  if (fixTld) {
    const fixedDomain = [...labels.slice(0, -1), fixTld].join(".");
    return { message: `".${tld}" looks like a typo for ".${fixTld}".`, suggestion: `${local}@${fixedDomain}` };
  }
  if (!/^[a-z]{2,24}$/.test(tld) && !tld.startsWith("xn--")) return { message: "The ending after the last dot is not a real one.", suggestion: null };

  // A mistyped well-known provider (gmial.com, gmail.co, yaho.com, ...).
  if (!COMMON_DOMAINS.includes(domain)) {
    const near = COMMON_DOMAINS.filter((d) => d.length >= 7 && distance(domain, d) <= 2).sort((a, b) => distance(domain, a) - distance(domain, b))[0];
    if (near) return { message: `"${domain}" looks like a typo for "${near}".`, suggestion: `${local}@${near}` };
  }

  if (commaFixed || trimmed) return { message: "The address has stray punctuation.", suggestion: `${local}@${domain}` };
  return null;
}
