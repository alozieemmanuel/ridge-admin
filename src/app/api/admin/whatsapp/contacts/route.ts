import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { normalizePhone } from "@/lib/whatsapp";

export const runtime = "nodejs";

/** Finds this event's contacts by name, email or phone, for starting a new chat. */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "whatsapp" });
  if (!ctx.ok) return ctx.response;

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ contacts: [] });

  const registrations = await prisma.registration.findMany({
    where: { eventId: ctx.event.id, OR: [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] },
    select: { fullName: true, phone: true },
    take: 12,
  });

  const contacts = registrations.map((r) => ({ name: r.fullName, phone: r.phone, kind: "Contact" })).filter((c) => normalizePhone(c.phone));
  return NextResponse.json({ contacts });
}
