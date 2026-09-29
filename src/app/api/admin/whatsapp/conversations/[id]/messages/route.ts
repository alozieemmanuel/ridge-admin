import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { sendWhatsAppMessageSchema } from "@/lib/validation";
import {
  fillTemplateBody,
  isWindowOpen,
  listApprovedTemplates,
  recordOutbound,
  sendWhatsAppTemplate,
  sendWhatsAppText,
} from "@/lib/whatsapp";

export const runtime = "nodejs";

/** The thread. Pass ?markRead=1 when the admin is actually looking at it. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const conversation = await prisma.whatsAppConversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  if (request.nextUrl.searchParams.get("markRead") === "1" && conversation.unreadCount > 0) {
    await prisma.whatsAppConversation.update({ where: { id }, data: { unreadCount: 0 } });
  }

  const messages = await prisma.whatsAppMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const [registration, prospect] = await Promise.all([
    conversation.registrationId
      ? prisma.registration.findUnique({ where: { id: conversation.registrationId }, select: { fullName: true } })
      : null,
    conversation.prospectId
      ? prisma.prospect.findUnique({ where: { id: conversation.prospectId }, select: { fullName: true } })
      : null,
  ]);

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      waId: conversation.waId,
      name: registration?.fullName ?? prospect?.fullName ?? conversation.contactName ?? null,
      kind: registration ? "registration" : prospect ? "prospect" : null,
      windowOpen: isWindowOpen(conversation.lastInboundAt),
      windowClosesAt: conversation.lastInboundAt ? new Date(conversation.lastInboundAt.getTime() + 24 * 60 * 60 * 1000).toISOString() : null,
    },
    messages: messages.reverse().map((m) => ({
      id: m.id,
      direction: m.direction,
      type: m.type,
      body: m.body,
      templateName: m.templateName,
      status: m.status,
      errorMessage: m.errorMessage,
      sentByName: m.sentByName,
      isBroadcast: Boolean(m.broadcastId),
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

/** Sends a free-text reply (inside the 24-hour window) or an approved template message. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = sendWhatsAppMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payload." }, { status: 400 });
  }

  const conversation = await prisma.whatsAppConversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  const data = parsed.data;
  let result;
  let body: string;
  let templateName: string | undefined;

  if (data.type === "text") {
    if (!isWindowOpen(conversation.lastInboundAt)) {
      return NextResponse.json(
        { error: "WhatsApp only allows free-text messages within 24 hours of the person's last message. Send a template message instead." },
        { status: 409 }
      );
    }
    body = data.body;
    result = await sendWhatsAppText(conversation.waId, data.body);
  } else {
    // Show what was actually sent: the template body with the variables filled in.
    let bodyText = "";
    try {
      const templates = await listApprovedTemplates();
      bodyText = templates.find((t) => t.name === data.templateName && t.language === data.language)?.bodyText ?? "";
    } catch {
      // the send below will surface a connection problem; the preview just falls back to the template name
    }
    body = bodyText ? fillTemplateBody(bodyText, data.params) : `[Template: ${data.templateName}]`;
    templateName = data.templateName;
    result = await sendWhatsAppTemplate(conversation.waId, data.templateName, data.language, data.params);
  }

  const message = await recordOutbound({
    conversationId: id,
    type: data.type,
    body,
    templateName,
    result,
    sentByName: session.name,
  });

  await logAdminAction(
    session,
    {
      action: "whatsapp.send",
      entityType: "whatsapp",
      entityId: id,
      entityLabel: `+${conversation.waId}`,
      details: { type: data.type, ok: result.ok, ...(templateName ? { template: templateName } : {}) },
    },
    request
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error || "WhatsApp rejected the message.", messageId: message.id }, { status: 502 });
  }
  return NextResponse.json({ result: "success", messageId: message.id });
}
