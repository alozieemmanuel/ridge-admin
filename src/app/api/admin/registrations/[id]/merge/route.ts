import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import { recordEmailAlias } from "@/lib/emailAliases";

export const runtime = "nodejs";

const bodySchema = z.object({ intoId: z.string().min(1) }).strict();

/**
 * Folds a duplicate guest into the guest who is already on the list (owner only). Use it when a wrong email address was
 * corrected and the corrected address already belongs to someone: they are the same person, entered twice (for example
 * once by the guest and once again by the live sheet).
 *
 * The follow-up log moves across, blanks on the kept guest are filled in, then the duplicate is removed and the correction
 * is remembered so the live sheet does not bring the duplicate back. Nothing is merged when the duplicate has a seat
 * reservation, a ticket, a check-in or a payment, because that would lose something that cannot be recovered: those are
 * sorted out by hand from the guest's own page.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEvent(request, { owner: true });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Say which guest to keep." }, { status: 400 });
  const { intoId } = parsed.data;
  if (intoId === id) return NextResponse.json({ error: "A guest cannot be merged into themselves." }, { status: 400 });

  const [dup, keep] = await Promise.all([
    prisma.registration.findFirst({ where: { id, eventId: event.id } }),
    prisma.registration.findFirst({ where: { id: intoId, eventId: event.id } }),
  ]);
  if (!dup || !keep) return NextResponse.json({ error: "One of the two guests was not found." }, { status: 404 });

  const holds = [
    dup.reservedAt && "a seat reservation",
    dup.ticketCode && "a ticket",
    dup.checkedInAt && "a check-in",
    dup.attendanceMode && "an attendance choice",
    (dup.amountPaid ?? 0) > 0 && "a payment",
  ].filter(Boolean) as string[];
  if (holds.length) {
    return NextResponse.json({ error: `${dup.fullName} (${dup.email}) has ${holds.join(" and ")}, so they were not merged automatically. Open their page and sort it out by hand.` }, { status: 409 });
  }

  const dupExtra = (dup.extra as Record<string, string> | null) ?? {};
  const keepExtra = (keep.extra as Record<string, string> | null) ?? {};
  await prisma.$transaction([
    prisma.followUpNote.updateMany({ where: { registrationId: dup.id }, data: { registrationId: keep.id } }),
    prisma.registration.update({
      where: { id: keep.id },
      data: {
        ...(keep.phone ? {} : dup.phone ? { phone: dup.phone } : {}),
        ...(keep.followUpStatus === "NOT_CONTACTED" && dup.followUpStatus !== "NOT_CONTACTED" ? { followUpStatus: dup.followUpStatus } : {}),
        ...(keep.inviteSentAt || !dup.inviteSentAt ? {} : { inviteSentAt: dup.inviteSentAt }),
        ...(keep.callFeedback || !dup.callFeedback ? {} : { callFeedback: dup.callFeedback }),
        ...(Object.keys(dupExtra).length ? { extra: { ...dupExtra, ...keepExtra } } : {}),
      },
    }),
    prisma.registration.delete({ where: { id: dup.id } }),
  ]);
  await recordEmailAlias(event.id, dup.email, keep.email);
  await logAdminAction(
    session,
    { action: "registration.delete", entityType: "registration", entityId: dup.id, entityLabel: dup.fullName, details: { email: dup.email, mergedInto: keep.email } },
    request
  );
  return NextResponse.json({ result: "success", keptId: keep.id });
}
