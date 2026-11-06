import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { blockedMembers, mailchimpConfigured, SKIPPED_ON_PURPOSE } from "@/lib/mailchimp";

export const runtime = "nodejs";
export const maxDuration = 60;

type Guest = { id: string; fullName: string; email: string; phone: string };

/**
 * The guests of this event that Mailchimp will not email: unsubscribed, cleaned (the address bounced) or archived.
 * Read live from Mailchimp. When Mailchimp is slow or refuses, the page still gets an answer: the guests Mailchimp
 * turned away in earlier sends (kept in the email history), with a note saying the list may be out of date.
 */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "campaigns" });
  if (!ctx.ok) return ctx.response;
  const { event } = ctx;
  if (!mailchimpConfigured()) return NextResponse.json({ configured: false, items: [] });

  const guests: Guest[] = await prisma.registration.findMany({
    where: { eventId: event.id, email: { not: "" } },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, email: true, phone: true },
  });

  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Mailchimp took too long to answer.")), 45_000);
    });
    const live = await Promise.race([blockedMembers(), deadline]).finally(() => clearTimeout(timer));
    const blocked = new Map(live.map((b) => [b.email, b.status]));
    const items = guests.flatMap((g) => {
      const status = blocked.get(g.email.trim().toLowerCase());
      return status ? [{ ...g, status }] : [];
    });
    return NextResponse.json({ configured: true, source: "live", checked: guests.length, items });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      const rows = await prisma.emailEvent.findMany({
        where: { type: "FAILED", provider: "MAILCHIMP", registration: { eventId: event.id }, errorMessage: { contains: "in Mailchimp" } },
        orderBy: { occurredAt: "desc" },
        select: { registrationId: true, errorMessage: true },
        take: 5000,
      });
      const byId = new Map(guests.map((g) => [g.id, g]));
      const seen = new Set<string>();
      const items = rows.flatMap((r: { registrationId: string | null; errorMessage: string | null }) => {
        const g = r.registrationId ? byId.get(r.registrationId) : undefined;
        const m = r.errorMessage ? SKIPPED_ON_PURPOSE.exec(r.errorMessage) : null;
        if (!g || !m || seen.has(g.id)) return [];
        seen.add(g.id);
        return [{ ...g, status: m[1] }];
      });
      return NextResponse.json({ configured: true, source: "history", warning: `${reason} Showing the guests Mailchimp turned away in earlier sends instead. This may be out of date.`, checked: guests.length, items });
    } catch {
      return NextResponse.json({ error: reason }, { status: 502 });
    }
  }
}
