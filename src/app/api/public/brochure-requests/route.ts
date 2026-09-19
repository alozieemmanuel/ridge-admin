import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { brochureRequestSchema } from "@/lib/validation";
import { sendBrochureEmails } from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = brochureRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
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

  return NextResponse.json({ result: "success" });
}
