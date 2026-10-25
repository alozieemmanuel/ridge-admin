import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import { describeActivity } from "@/lib/activity";
import { reserveLink } from "@/lib/notifications";
import { EMAIL_RE } from "@/lib/csvImport";

export const runtime = "nodejs";

/** One participant in full: contact details, the follow-up log, invitation / reservation / ticket / attendance state, extra CSV columns and everything that has happened to them. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const { event } = ctx;
  const { id } = await params;
  const [r, audit] = await Promise.all([
    prisma.registration.findFirst({
      where: { id, eventId: event.id },
      include: { followUpNotes: { orderBy: { createdAt: "desc" } } },
    }),
    prisma.auditLog.findMany({
      where: { entityType: "registration", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 150,
      select: { id: true, adminName: true, action: true, details: true, createdAt: true },
    }),
  ]);
  if (!r) return NextResponse.json({ error: "Participant not found." }, { status: 404 });

  const activity = audit.map(describeActivity).filter((a): a is NonNullable<typeof a> => a !== null);
  activity.push({ id: "added", title: "Added to the guest list", detail: null, by: "System", at: r.createdAt.toISOString(), tone: "normal" });

  return NextResponse.json({
    participant: {
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      followUpStatus: r.followUpStatus,
      extra: (r.extra as Record<string, string> | null) ?? {},
      inviteSentAt: r.inviteSentAt?.toISOString() ?? null,
      reservedAt: r.reservedAt?.toISOString() ?? null,
      ticketCode: r.ticketCode,
      ticketSentAt: r.ticketSentAt?.toISOString() ?? null,
      checkedInAt: r.checkedInAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      reserveLink: reserveLink(r, event.slug),
      followUps: r.followUpNotes.map((n) => ({ id: n.id, status: n.status, body: n.body, authorName: n.authorName, createdAt: n.createdAt.toISOString() })),
      activity,
    },
  });
}

const updateSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter the guest's name.").max(200).optional(),
    email: z.string().trim().toLowerCase().max(320).optional(),
    phone: z.string().trim().max(40).optional(),
  })
  .strict();

/** Edits a participant's contact details. Only the fields sent are changed. (Follow-up has its own route, so every call is logged with its feedback.) */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid details." }, { status: 400 });
  }
  const data = parsed.data;
  if (data.email !== undefined && !EMAIL_RE.test(data.email)) {
    return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  }

  const existing = await prisma.registration.findFirst({ where: { id, eventId: event.id } });
  if (!existing) return NextResponse.json({ error: "Participant not found." }, { status: 404 });

  if (data.email && data.email !== existing.email) {
    const clash = await prisma.registration.findFirst({ where: { eventId: event.id, email: data.email }, select: { id: true, fullName: true } });
    if (clash) return NextResponse.json({ error: `${clash.fullName} is already on the list with that email address.` }, { status: 409 });
  }

  await prisma.registration.update({
    where: { id },
    data: {
      ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
    },
  });

  const changes = (["fullName", "email", "phone"] as const)
    .filter((f) => data[f] !== undefined && data[f] !== existing[f])
    .map((f) => ({ field: f, from: existing[f], to: data[f] as string }));
  if (changes.length) {
    await logAdminAction(session, { action: "participant.update", entityType: "registration", entityId: id, entityLabel: existing.fullName, details: { changes } }, request);
  }

  return NextResponse.json({ result: "success" });
}

/** Permanently deletes one participant (owner only), with their notes and email history. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEvent(request, { owner: true });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;
  const { id } = await params;
  const existing = await prisma.registration.findFirst({ where: { id, eventId: event.id }, select: { id: true, fullName: true, email: true } });
  if (!existing) return NextResponse.json({ error: "Participant not found." }, { status: 404 });

  await prisma.registration.delete({ where: { id } });
  await logAdminAction(
    session,
    { action: "registration.delete", entityType: "registration", entityId: id, entityLabel: existing.fullName, details: { email: existing.email } },
    request
  );
  return NextResponse.json({ result: "success" });
}
