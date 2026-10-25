import { NextRequest, NextResponse } from "next/server";
import { requireEvent } from "@/lib/event";
import { prisma } from "@/lib/prisma";
import { DEFAULT_EMAIL_TEMPLATES, EDITABLE_TEMPLATE_KEYS } from "@/lib/emailDefaults";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  // Only the event emails are editable; templates left over from the switched-off modules stay hidden.
  const rows = await prisma.emailTemplate.findMany({ where: { eventId: ctx.event.id, key: { in: EDITABLE_TEMPLATE_KEYS } } });
  // A template that hasn't been seeded yet shows its default wording, and is created when it is first saved.
  const templates = DEFAULT_EMAIL_TEMPLATES.map((d) => rows.find((r) => r.key === d.key) ?? { key: d.key, subject: d.subject, body: d.body, replyTo: d.replyTo });
  return NextResponse.json({ templates });
}
