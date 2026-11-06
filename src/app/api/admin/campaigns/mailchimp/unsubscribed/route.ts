import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { blockedMembers, mailchimpConfigured } from "@/lib/mailchimp";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The guests of this event that Mailchimp will not email: unsubscribed, cleaned (the address bounced) or archived.
 * Read live from Mailchimp, so the list is always current. Only the guests on this event are returned.
 */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "campaigns" });
  if (!ctx.ok) return ctx.response;
  const { event } = ctx;
  if (!mailchimpConfigured()) return NextResponse.json({ configured: false, items: [] });

  try {
    const blocked = new Map((await blockedMembers()).map((b) => [b.email, b.status]));
    const guests = await prisma.registration.findMany({
      where: { eventId: event.id, email: { not: "" } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, email: true, phone: true },
    });
    const items = guests.flatMap((g: { id: string; fullName: string; email: string; phone: string }) => {
      const status = blocked.get(g.email.trim().toLowerCase());
      return status ? [{ ...g, status }] : [];
    });
    return NextResponse.json({ configured: true, checked: guests.length, items });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
