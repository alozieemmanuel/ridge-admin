import crypto from "node:crypto";

/**
 * A signed, proof-upload-only token handed back after a public registration.
 * It stands in for the registration id so the public site never learns the id
 * itself (which is also the key in the seat-selection link).
 */
function sign(payload: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  return crypto.createHmac("sha256", secret).update(`proof:${payload}`).digest("base64url");
}

export function makeProofToken(registrationId: string): string {
  const payload = Buffer.from(registrationId).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyProofToken(token: string): string | null {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = sign(payload);
    const a = new Uint8Array(Buffer.from(signature));
    const b = new Uint8Array(Buffer.from(expected));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return Buffer.from(payload, "base64url").toString("utf-8");
  }