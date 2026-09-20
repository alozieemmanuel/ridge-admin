import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonWithCors, preflight } from "@/lib/cors";
import { verifyProofToken } from "@/lib/proof-token";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024; // stays under Vercel's 4.5 MB request limit
const MAX_PROOFS_PER_REGISTRATION = 10;
const CURRENCIES = new Set(["USD", "CAD", "NGN", "USD_NG"]);
const METHODS = new Set(["bank_transfer", "interac"]);

export async function OPTIONS(request: NextRequest) {
  return preflight(request);
}

/** Identifies the real file type from its first bytes rather than trusting the browser's label. */
function sniffType(bytes: Buffer): string | null {
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (bytes.length > 4 && bytes.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP")
    return "image/webp";
  return null;
}

/** Receives a proof-of-payment file (multipart: token, currency, amount, expected?, method?, file) from the public payment screen. */
export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonWithCors(request, { error: "Invalid upload." }, 400);
  }

  const registrationId = verifyProofToken(String(form.get("token") || ""));
  if (!registrationId) {
    return jsonWithCors(request, { error: "This upload link isn't valid. Please register again." }, 400);
  }

  const currency = String(form.get("currency") || "");
  const methodRaw = String(form.get("method") || "");
  if (!CURRENCIES.has(currency)) return jsonWithCors(request, { error: "Choose a currency." }, 400);
  const method = METHODS.has(methodRaw) ? methodRaw : null;

  const amountClaimed = parseFloat(String(form.get("amount") || ""));
  if (!Number.isFinite(amountClaimed) || amountClaimed <= 0 || amountClaimed > 1_000_000_000) {
    return jsonWithCors(request, { error: "Enter the amount you paid." }, 400);
  }
  const expectedRaw = parseFloat(String(form.get("expected") || ""));
  const expectedAmount = Number.isFinite(expectedRaw) && expectedRaw > 0 ? expectedRaw : null;

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return jsonWithCors(request, { error: "Choose a file to upload." }, 400);
  }
  if (file.size > MAX_BYTES) {
    return jsonWithCors(request, { error: "That file is too large. Please upload a file under 4 MB." }, 400);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = sniffType(bytes);
  if (!mimeType) {
    return jsonWithCors(request, { error: "Please upload a photo (JPG, PNG, WebP) or a PDF." }, 400);
  }

  const registration = await prisma.registration.findUnique({ where: { id: registrationId }, select: { id: true } });
  if (!registration) return jsonWithCors(request, { error: "Registration not found." }, 404);

  const existing = await prisma.paymentProof.count({ where: { registrationId } });
  if (existing >= MAX_PROOFS_PER_REGISTRATION) {
    return jsonWithCors(request, { error: "Too many files uploaded for this registration." }, 429);
  }

  await prisma.paymentProof.create({
    data: {
      registrationId,
      currency,
      method,
      amountClaimed,
      expectedAmount,
      fileName: (file.name || "proof").replace(/[^\w.\- ]+/g, "_").slice(0, 120),
      mimeType,
      size: bytes.length,
      data: bytes,
    },
  });

  return jsonWithCors(request, { result: "success" });
}