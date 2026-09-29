import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { sendWhatsAppBroadcastSchema } from "@/lib/validation";
import { getOrCreateConversation, fillTemplateBody, listApprovedTemplates, recordOutbound, sendWhatsAppTemplate } from "@/lib/whatsapp";
import { resolveWhatsAppAudience, whatsappAudienceCounts, WHATSAPP_AUDIENCE_LABELS, type WhatsAppAudience } from "@/lib/whatsapp-audience";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Past broadcasts plus how many people each audience has a usable number for. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [broadcasts, counts] = await Promise.all([
    prisma.whatsAppBroadcast.findMany({ orderBy: { sentAt: "desc" }, take: 50 }),
    whatsappAudienceCounts(),
  ]);

  const ids = broadcasts.map((b) => b.id);
  const grouped = ids.length
    ? await prisma.whatsAppMessage.groupBy({
        by: ["broadcastId", "status"],
        where: { broadcastId: { in: ids } },
        _count: { _all: true },
      })
    : [];
  const stats: Record<string, { delivered: number; read: number }> = {};
  for (const g of grouped) {
    if (!g.broadcastId) continue;
    stats[g.broadcastId] ??= { delivered: 0, read: 0 };
    // A message that was read was also delivered.
    if (g.status === "DELIVERED" || g.status === "READ") stats[g.broadcastId].delivered += g._count._all;
    if (g.status === "READ") stats[g.broadcastId].read += g._count._all;
  }

  return NextResponse.json({
    labels: WHATSAPP_AUDIENCE_LABELS,
    counts,
    broadcasts: broadcasts.map((b) => ({
      id: b.id,
      audience: b.audience,
      templateName: b.templateName,
      previewText: b.previewText,
      recipientCount: b.recipientCount,
      sentCount: b.sentCount,
      failedCount: b.failedCount,
      sentAt: b.sentAt.toISOString(),
      sentByName: b.sentByName,
      delivered: stats[b.id]?.delivered ?? 0,
      read: stats[b.id]?.read ?? 0,
    })),
  });
}

/**
 * Sends one approved template to everyone in an audience. Only templates can
 * start a conversation on WhatsApp, so broadcasts are template-only. Params
 * may use {{first_name}} / {{full_name}} to personalize per person.
 * Sends run in small parallel batches; each outcome is stored on that
 * person's conversation, so replies land in the WhatsApp inbox.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = sendWhatsAppBroadcastSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payload." }, { status: 400 });
  }
  const { audience, templateName, language, params } = parsed.data;

  let template;
  try {
    const templates = await listApprovedTemplates();
    template = templates.find((t) => t.name === templateName && t.language === language);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load templates." }, { status: 502 });
  }
  if (!template) return NextResponse.json({ error: "That template isn't approved (or doesn't exist)." }, { status: 400 });
  if (!template.supported) return NextResponse.json({ error: `This template can't be used here: ${template.unsupportedReason}.` }, { status: 400 });
  if (params.length < template.variableCount || params.slice(0, template.variableCount).some((p) => !p.trim())) {
    return NextResponse.json({ error: `Fill in all ${template.variableCount} template variable(s).` }, { status: 400 });
  }

  const all = await resolveWhatsAppAudience(audience as WhatsAppAudience);
  const recipients = all.filter((r): r is typeof r & { waId: string } => Boolean(r.waId));
  if (recipients.length === 0) {
    return NextResponse.json({ error: "Nobody in that audience has a usable phone number." }, { status: 400 });
  }

  const broadcast = await prisma.whatsAppBroadcast.create({
    data: {
      audience,
      templateName,
      templateLanguage: language,
      templateParams: params,
      previewText: fillTemplateBody(template.bodyText, params),
      recipientCount: recipients.length,
      sentByName: session.name,
    },
  });

  let sentCount = 0;
  let failedCount = 0;
  const usedParams = params.slice(0, template.variableCount);

  try {
    const CONCURRENCY = 5;
    for (let i = 0; i < recipients.length; i += CONCURRENCY) {
      const batch = recipients.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (r) => {
          const first = r.fullName.trim().split(/\s+/)[0] || "there";
          const personal = usedParams.map((p) => p.replace(/\{\{\s*first_name\s*\}\}/g, first).replace(/\{\{\s*full_name\s*\}\}/g, r.fullName));
          const result = await sendWhatsAppTemplate(r.waId, templateName, language, personal);
          try {
            const conversation = await getOrCreateConversation(r.waId, { name: r.fullName });
            await recordOutbound({
              conversationId: conversation.id,
              type: "template",
              body: fillTemplateBody(template.bodyText, personal),
              templateName,
              result,
              sentByName: session.name,
              broadcastId: broadcast.id,
            });
          } catch (err) {
            console.error("[whatsapp] Couldn't record broadcast message:", err);
          }
          return result.ok;
        })
      );
      for (const ok of results) ok ? sentCount++ : failedCount++;
    }
  } finally {
    await prisma.whatsAppBroadcast.update({ where: { id: broadcast.id }, data: { sentCount, failedCount } });
  }

  await logAdminAction(
    session,
    {
      action: "whatsapp.broadcast",
      entityType: "whatsapp_broadcast",
      entityId: broadcast.id,
      entityLabel: templateName,
      details: { audience, recipients: recipients.length, sent: sentCount, failed: failedCount },
    },
    request
  );

  return NextResponse.json({ result: "success", broadcast: { id: broadcast.id, recipientCount: recipients.length, sentCount, failedCount } });
}
