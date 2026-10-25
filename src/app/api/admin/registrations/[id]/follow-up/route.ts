import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import { FOLLOW_UP_VALUES } from "@/lib/followUp";

export const runtime = "nodejs";

const schema = z.object({
  status: z.enum(FOLLOW_UP_VALUES as [string, ...string[]]),
  feedback: z.string().trim().max(5000, "That feedback is too long (max 5,000 characters).").optional(),
});

/**
 * Logs a phone follow-up: sets the guest's follow-up status and, when there is feedback, adds it to their follow-up log
 * with the time and the admin who wrote it. Body: { status, feedback? }. This is the one place follow-up changes are made.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid follow-up." }, { status: 400 });
  const { status, feedback } = parsed.data;

  const existing = await prisma.registration.findFirst({ where: { id, eventId: event.id }, select: { fullName: true, followUpStatus: true } });
  if (!existing) return NextResponse.json({ error: "Participant not found." }, { status: 404 });

  const [, entry] = await prisma.$transaction([
    prisma.registration.update({ where: { id }, data: { followUpStatus: status } }),
    prisma.followUpNote.create({ data: { registrationId: id, status, body: feedback ?? "", authorName: session.name } }),
  ]);

  await logAdminAction(
    session,
    {
      action: "participant.follow_up",
      entityType: "registration",
      entityId: id,
      entityLabel: existing.fullName,
      details: { from: existing.followUpStatus, to: status, feedback: feedback ?? "" },
    },
    request
  );

  return NextResponse.json({
    result: "success",
    entry: { id: entry.id, status: entry.status, body: entry.body, authorName: entry.authorName, createdAt: entry.createdAt.toISOString() },
  });
}
