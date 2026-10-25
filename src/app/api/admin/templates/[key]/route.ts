import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateTemplateSchema } from "@/lib/validation";
import { defaultTemplate } from "@/lib/emailDefaults";
import { requireEvent } from "@/lib/event";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const { key } = await params;
  const template = await prisma.emailTemplate.findUnique({ where: { eventId_key: { eventId: ctx.event.id, key } } });
  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }
  return NextResponse.json({ template });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
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

  if (!defaultTemplate(key)) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const data = { subject: parsed.data.subject, body: parsed.data.body, replyTo: parsed.data.replyTo || null };
  const template = await prisma.emailTemplate.upsert({ where: { eventId_key: { eventId: ctx.event.id, key } }, update: data, create: { eventId: ctx.event.id, key, ...data } });

  return NextResponse.json({ result: "success", template });
}
