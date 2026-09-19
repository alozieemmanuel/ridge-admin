import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { brochureRequestSchema } from "@/lib/validation";
import { sendBrochureEmails } from "@/lib/notifications";
import { jsonWithCors, preflight } from "@/lib/cors";

export const runtime = "nodejs";

export async function OPTIONS(request: NextRequest) {
  return preflight(request);
}

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonWithCors(request, { error: "Invalid JSON body." }, 400);
  }

  const parsed = brochureRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonWithCors(
      request,
      { error: "Validation failed.", details: parsed.error.flatten().fieldErrors },
      400
    );
  }

  const data = parsed.data;

  const brochureRequest = await prisma.brochureRequest.create({
    data: {
      fullName: data.fullName,
      email: data.email.toLowerCase(),
    },
  });

  try {
    await sendBrochureEmails(brochureRequest);
  } catch (err) {
    console.error("[brochure-requests] Failed to send confirmation/notification emails:", err);
  }

  return jsonWithCors(request, { result: "success" });
}