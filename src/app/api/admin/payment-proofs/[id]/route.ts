import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";

export const runtime = "nodejs";

/** Serves an uploaded proof-of-payment file to a signed-in admin. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proof = await prisma.paymentProof.findUnique({ where: { id } });
  if (!proof) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return new NextResponse(new Uint8Array(proof.data), {
    headers: {
      "Content-Type": proof.mimeType,
      "Content-Disposition": `inline; filename="${proof.fileName}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      "Cache-Control": "private, max-age=300",
    },
  });
}

/** Rejects an uploaded receipt (e.g. it's unreadable or doesn't match). No email is sent. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  const proof = await prisma.paymentProof.findUnique({
    where: { id },
    select: { id: true, status: true, registrationId: true, registration: { select: { fullName: true } } },
  });
  if (!proof) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (proof.status !== "PENDING") {
    return NextResponse.json({ error: "This receipt has already been reviewed." }, { status: 409 });
  }

  await prisma.paymentProof.update({
    where: { id },
    data: { status: "REJECTED", reviewedAt: new Date(), reviewedByName: session?.name ?? null },
  });
  await logAdminAction(
    session,
    {
      action: "payment_proof.reject",
      entityType: "registration",
      entityId: proof.registrationId,
      entityLabel: proof.registration.fullName,
      details: { proofId: id },
    },
    request
  );
  return NextResponse.json({ result: "success" });
}