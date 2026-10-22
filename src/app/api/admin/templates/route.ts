import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEFAULT_EMAIL_TEMPLATES, EDITABLE_TEMPLATE_KEYS } from "@/lib/emailDefaults";

export const runtime = "nodejs";

export async function GET() {
  // Only the Investor Hangout emails are editable; templates left over from the switched-off modules stay hidden.
  const rows = await prisma.emailTemplate.findMany({ where: { key: { in: EDITABLE_TEMPLATE_KEYS } } });
  // A template that hasn't been seeded yet shows its default wording, and is created when it is first saved.
  const templates = DEFAULT_EMAIL_TEMPLATES.map((d) => rows.find((r) => r.key === d.key) ?? { key: d.key, subject: d.subject, body: d.body, replyTo: d.replyTo });
  return NextResponse.json({ templates });
}
