import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { emailProblem } from "@/lib/emailCheck";

export const runtime = "nodejs";

/** Every contact whose email address is wrong or looks like a typo, with a suggested correction where one can be guessed. */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const { event } = ctx;

  const all = await prisma.registration.findMany({
    where: { eventId: event.id },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, fullName: true, email: true, phone: true },
  });
  const items = all.flatMap((r: { id: string; fullName: string; email: string; phone: string }) => {
    // Contacts with no email at all are only a problem when the event needs one.
    if (!r.email.trim() && event.emailOptional) return [];
    const p = emailProblem(r.email);
    return p ? [{ ...r, message: p.message, suggestion: p.suggestion }] : [];
  });
  return NextResponse.json({ checked: all.length, items });
}
