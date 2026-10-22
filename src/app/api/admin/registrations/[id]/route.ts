import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { FOLLOW_UP_VALUES } from "@/lib/followUp";
import { reserveLink } from "@/lib/notifications";
import { EMAIL_RE } from "@/lib/csvImport";

export const runtime = "nodejs";

/** One participant in full: contact details, follow-up, every call note, invitation / reservation / ticket / attendance history and any extra CSV columns. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await prisma.registration.findUnique({
    where: { id },
    include: {
      followUpNotes: { orderBy: { createdAt: "desc" } },
      emailEvents: {
        where: { audience: "ATTENDEE", source: "REGISTRATION" },
        orderBy: { occurredAt: "desc" },
        take: 30,
        select: { id: true, kind: true, type: true, subject: true, errorMessage: true, occurredAt: true },
      },
    },
  });
  if (!r) return NextResponse.json({ error: "Participant not found." }, { status: 404 });

  return NextResponse.json({
    participant: {
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      organization: r.organization,
      followUpStatus: r.followUpStatus,
      callFeedback: r.callFeedback,
      extra: (r.extra as Record<string, string> | null) ?? {},
      inviteSentAt: r.inviteSentAt?.toISOString() ?? null,
      reservedAt: r.reservedAt?.toISOString() ?? null,
      ticketCode: r.ticketCode,
      ticketSentAt: r.ticketSentAt?.toISOString() ?? null,
      checkedInAt: r.checkedInAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      reserveLink: reserveLink(r),
      notes: r.followUpNotes.map((n) => ({ id: n.id, body: n.body, authorName: n.authorName, createdAt: n.createdAt.toISOString() })),
      emails: r.emailEvents.map((e) => ({
        id: e.id,
        kind: e.kind,
        type: e.type,
        subject: e.subject,
        error: e.errorMessage,
        at: e.occurredAt.toISOString(),
      })),
    },
  });
}

const updateSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter the guest's name.").max(200).optional(),
    email: z.string().trim().toLowerCase().max(320).optional(),
    phone: z.string().trim().max(40).optional(),
    organization: z.string().trim().max(200).nullable().optional(),
    followUpStatus: z.enum(FOLLOW_UP_VALUES as [string, ...string[]]).optional(),
    callFeedback: z.string().trim().max(10000).nullable().optional(),
  })
  .strict();

/** Edits a participant's details, follow-up status or call feedback. Only the fields sent are changed. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

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

  const existing = await prisma.registration.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Participant not found." }, { status: 404 });

  if (data.email && data.email !== existing.email) {
    const clash = await prisma.registration.findUnique({ where: { email: data.email }, select: { id: true, fullName: true } });
    if (clash) return NextResponse.json({ error: `${clash.fullName} is already on the list with that email address.` }, { status: 409 });
  }

  const updated = await prisma.registration.update({
    where: { id },
    data: {
      ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.organization !== undefined ? { organization: data.organization || null } : {}),
      ...(data.followUpStatus !== undefined ? { followUpStatus: data.followUpStatus } : {}),
      ...(data.callFeedback !== undefined ? { callFeedback: data.callFeedback || null } : {}),
    },
  });

  const onlyFollowUp = Object.keys(data).length === 1 && data.followUpStatus !== undefined;
  await logAdminAction(
    session,
    {
      action: onlyFollowUp ? "participant.follow_up" : "participant.update",
      entityType: "registration",
      entityId: id,
      entityLabel: existing.fullName,
      details: onlyFollowUp
        ? { from: existing.followUpStatus, to: updated.followUpStatus }
        : { changedFields: Object.keys(data) },
    },
    request
  );

  return NextResponse.json({ result: "success" });
}

/** Permanently deletes one participant (owner only), with their notes and email history. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an owner can delete records." }, { status: 403 });
  }
  const { id } = await params;
  const existing = await prisma.registration.findUnique({ where: { id }, select: { id: true, fullName: true, email: true } });
  if (!existing) return NextResponse.json({ error: "Participant not found." }, { status: 404 });

  await prisma.registration.delete({ where: { id } });
  await logAdminAction(
    session,
    { action: "registration.delete", entityType: "registration", entityId: id, entityLabel: existing.fullName, details: { email: existing.email } },
    request
  );
  return NextResponse.json({ result: "success" });
}
