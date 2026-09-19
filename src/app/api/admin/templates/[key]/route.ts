import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateTemplateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const template = await prisma.emailTemplate.findUnique({ where: { key } });
  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }
  return NextResponse.json({ template });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = updateTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Validation failed.", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const existing = await prisma.emailTemplate.findUnique({ where: { key } });
  if (!existing) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const template = await prisma.emailTemplate.update({
    where: { key },
    data: {
      subject: parsed.data.subject,
      body: parsed.data.body,
      replyTo: parsed.data.replyTo || null,
    },
  });

  return NextResponse.json({ result: "success", template });
}
