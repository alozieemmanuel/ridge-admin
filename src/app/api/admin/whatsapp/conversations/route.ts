import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { startConversationSchema } from "@/lib/validation";
import { getOrCreateConversation, isWhatsAppConfigured, isWindowOpen, normalizePhone } from "@/lib/whatsapp";

export const runtime = "nodejs";

/** Conversation list, most recent first. Optional ?q= searches name and number. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const digits = q.replace(/\D/g, "");

  let where = {};
  if (q) {
    const [regs, prospects] = await Promise.all([
      prisma.registration.findMany({ where: { fullName: { contains: q, mode: "insensitive" } }, select: { id: true }, take: 50 }),
      prisma.prospect.findMany({ where: { fullName: { contains: q, mode: "insensitive" } }, select: { id: true }, take: 50 }),
    ]);
    where = {
      OR: [
        { contactName: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ waId: { contains: digits } }] : []),
        { registrationId: { in: regs.map((r) => r.id) } },
        { prospectId: { in: prospects.map((p) => p.id) } },
      ],
    };
  }

  const conversations = await prisma.whatsAppConversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: 150,
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const regIds = conversations.map((c) => c.registrationId).filter((v): v is string => Boolean(v));
  const prospectIds = conversations.map((c) => c.prospectId).filter((v): v is string => Boolean(v));
  const [regs, prospects] = await Promise.all([
    prisma.registration.findMany({ where: { id: { in: regIds } }, select: { id: true, fullName: true } }),
    prisma.prospect.findMany({ where: { id: { in: prospectIds } }, select: { id: true, fullName: true } }),
  ]);
  const regName = new Map(regs.map((r) => [r.id, r.fullName]));
  const prospectName = new Map(prospects.map((p) => [p.id, p.fullName]));

  return NextResponse.json({
    configured: isWhatsAppConfigured(),
    totalUnread: conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    conversations: conversations.map((c) => {
      const last = c.messages[0];
      return {
        id: c.id,
        waId: c.waId,
        name:
          (c.registrationId && regName.get(c.registrationId)) ||
          (c.prospectId && prospectName.get(c.prospectId)) ||
          c.contactName ||
          null,
        kind: c.registrationId ? "registration" : c.prospectId ? "prospect" : null,
        unreadCount: c.unreadCount,
        lastMessageAt: c.lastMessageAt.toISOString(),
        windowOpen: isWindowOpen(c.lastInboundAt),
        lastMessage: last ? { direction: last.direction, body: last.body, status: last.status } : null,
      };
    }),
  });
}

/** Opens (or creates) the thread for a phone number, so a first message can be sent to it. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = startConversationSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payload." }, { status: 400 });
  }

  const waId = normalizePhone(parsed.data.phone);
  if (!waId) {
    return NextResponse.json({ error: "That doesn't look like a valid phone number. Include the country code." }, { status: 400 });
  }

  const conversation = await getOrCreateConversation(waId, { name: parsed.data.name });
  return NextResponse.json({ result: "success", id: conversation.id });
}
