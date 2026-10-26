import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { startConversationSchema } from "@/lib/validation";
import { getOrCreateConversation, isWhatsAppConfigured, isWindowOpen, normalizePhone } from "@/lib/whatsapp";

export const runtime = "nodejs";

/** This event's chats, most recent first. Optional ?q= searches name and number. */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "whatsapp" });
  if (!ctx.ok) return ctx.response;
  const { event } = ctx;

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const digits = q.replace(/\D/g, "");

  let where: Record<string, unknown> = { eventId: event.id };
  if (q) {
    const regs = await prisma.registration.findMany({ where: { eventId: event.id, fullName: { contains: q, mode: "insensitive" } }, select: { id: true }, take: 50 });
    where = {
      eventId: event.id,
      OR: [{ contactName: { contains: q, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ waId: { contains: digits } }] : []), { registrationId: { in: regs.map((r) => r.id) } }],
    };
  }

  const conversations = await prisma.whatsAppConversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: 150,
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const regIds = conversations.map((c) => c.registrationId).filter((v): v is string => Boolean(v));
  const regs = await prisma.registration.findMany({ where: { id: { in: regIds } }, select: { id: true, fullName: true } });
  const regName = new Map(regs.map((r) => [r.id, r.fullName]));

  return NextResponse.json({
    configured: isWhatsAppConfigured(),
    totalUnread: conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    conversations: conversations.map((c) => {
      const last = c.messages[0];
      return {
        id: c.id,
        waId: c.waId,
        name: (c.registrationId && regName.get(c.registrationId)) || c.contactName || null,
        kind: c.registrationId ? "registration" : null,
        unreadCount: c.unreadCount,
        lastMessageAt: c.lastMessageAt.toISOString(),
        windowOpen: isWindowOpen(c.lastInboundAt),
        lastMessage: last ? { direction: last.direction, body: last.body, status: last.status } : null,
      };
    }),
  });
}

/** Opens (or creates) the chat for a phone number in this event, so a first message can be sent to it. */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "whatsapp" });
  if (!ctx.ok) return ctx.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = startConversationSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payload." }, { status: 400 });

  const waId = normalizePhone(parsed.data.phone);
  if (!waId) return NextResponse.json({ error: "That doesn't look like a valid phone number. Include the country code." }, { status: 400 });

  const conversation = await getOrCreateConversation(waId, { name: parsed.data.name, eventId: ctx.event.id });
  return NextResponse.json({ result: "success", id: conversation.id });
}
