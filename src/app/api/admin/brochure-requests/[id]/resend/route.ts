import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resendBrochureConfirmation } from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const brochureRequest = await prisma.brochureRequest.findUnique({ where: { id } });
  if (!brochureRequest) {
    return NextResponse.json({ error: "Brochure request not found." }, { status: 404 });
  }

  try {
    await resendBrochureConfirmation(brochureRequest);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email." },
      { status: 502 }
    );
  }

  return NextResponse.json({ result: "success" });
}
