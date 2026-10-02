import crypto from "node:crypto";

/**
 * Signed tokens that stand in for a registration id, so links never carry the
 * id itself. Each kind is signed with its own purpose, so a token from one link
 * cannot be used on another (a payment token will not open the seat page).
 */
function sign(purpose: string, payload: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  return crypto.createHmac("sha256", secret).update(`${purpose}:${payload}`).digest("base64url");
}

function make(purpose: string, registrationId: string): string {
  const payload = Buffer.from(registrationId).toString("base64url");
  return `${payload}.${sign(purpose, payload)}`;
}

function matches(signature: string, expected: string): boolean {
  const a = new Uint8Array(Buffer.from(signature));
  const b = new Uint8Array(Buffer.from(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verify(purpose: string, token: string, acceptLegacy = false): string | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  let ok = matches(signature, sign(purpose, payload));
  if (!ok && acceptLegacy) {
    // Proof tokens issued before purposes existed were signed over the payload alone.
    // Keep accepting them so a payment page that is already open still works.
    const secret = process.env.SESSION_SECRET;
    if (secret) ok = matches(signature, crypto.createHmac("sha256", secret).update(payload).digest("base64url"));
  }
  if (!ok) return null;
  return Buffer.from(payload, "base64url").toString("utf-8");
}

/** Proof-of-payment / pay-later token, handed back after a public registration and put in payment reminder links. */
export const makeProofToken = (registrationId: string) => make("proof", registrationId);
export const verifyProofToken = (token: string) => verify("proof", token, true);

/** Seat selection token, put in the seat invite and seat confirmation emails. */
export const makeSeatToken = (registrationId: string) => make("seat", registrationId);
export const verifySeatToken = (token: string) => verify("seat", token);
