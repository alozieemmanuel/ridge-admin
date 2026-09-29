import { SignJWT, importPKCS8 } from "jose";

/**
 * Minimal Google Sheets client for a service account. Uses `jose` (already a
 * dependency) to sign the OAuth JWT and plain fetch for the Sheets REST API,
 * so no extra packages are needed.
 *
 * Setup: create a service account in Google Cloud, enable the Google Sheets
 * API, then share each spreadsheet with the service account's email as Editor.
 * Provide credentials with EITHER
 *   GOOGLE_SERVICE_ACCOUNT_JSON  (the whole downloaded key file, as one line), OR
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 */

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

interface Credentials {
  email: string;
  privateKey: string;
}

export function getCredentials(): Credentials | null {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) {
        return { email: parsed.client_email, privateKey: parsed.private_key.replace(/\\n/g, "\n") };
      }
    } catch {
      console.error("[sheets] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
  }
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (email && key) {
    // Env dashboards often store the key with literal "\n" sequences.
    return { email, privateKey: key.replace(/\\n/g, "\n") };
  }
  return null;
}

export function isSheetsConfigured(): boolean {
  return getCredentials() !== null;
}

export function serviceAccountEmail(): string | null {
  return getCredentials()?.email ?? null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      "Google credentials are not set. Add GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) on the server."
    );
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;

  const key = await importPKCS8(creds.privateKey, "RS256");
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(creds.email)
    .setSubject(creds.email)
    .setAudience(TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google sign-in failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return data.access_token;
}

function describeSheetsError(status: number, body: string, spreadsheetId: string): string {
  let message = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) message = parsed.error.message;
  } catch {
    // keep the raw body
  }
  if (status === 403 || status === 404) {
    const email = serviceAccountEmail();
    return `Google Sheets ${status}: ${message}. Check the spreadsheet id and that it is shared${
      email ? ` with ${email}` : " with the service account"
    } as an Editor.`;
  }
  return `Google Sheets ${status} (${spreadsheetId.slice(0, 8)}…): ${message}`;
}

async function sheetsFetch(spreadsheetId: string, path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(describeSheetsError(res.status, await res.text(), spreadsheetId));
  return res;
}

/** Quote a tab name for A1 notation: 'My Tab'!A1 (single quotes doubled). */
function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

/** 0 -> A, 25 -> Z, 26 -> AA ... */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Pulls the spreadsheet id out of a full URL, or returns the input if it already looks like an id. */
export function parseSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : trimmed;
}

/**
 * Reads the whole tab as text exactly as shown in the sheet (checkboxes come
 * back as "TRUE"/"FALSE"). Row 0 of the result is the header row. Rows can be
 * shorter than the header row; missing cells are simply absent.
 */
export async function readSheet(spreadsheetId: string, tab: string): Promise<string[][]> {
  const range = encodeURIComponent(quoteTab(tab));
  const res = await sheetsFetch(spreadsheetId, `/values/${range}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`);
  const data = (await res.json()) as { values?: unknown[][] };
  return (data.values ?? []).map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
}

export interface CellUpdate {
  /** 1-based sheet row */
  row: number;
  /** 0-based column index */
  col: number;
  value: string;
}

/** Writes individual cells in one request. Values are entered as if typed (dates, checkboxes and numbers are interpreted). */
export async function updateCells(spreadsheetId: string, tab: string, updates: CellUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  await sheetsFetch(spreadsheetId, "/values:batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: updates.map((u) => ({
        range: `${quoteTab(tab)}!${columnLetter(u.col)}${u.row}`,
        values: [[u.value]],
      })),
    }),
  });
}
