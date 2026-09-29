import crypto from "node:crypto";
import type { Prisma, WhatsAppStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * WhatsApp Business Cloud API (Meta) client and helpers.
 *
 * Environment variables:
 *   WHATSAPP_ACCESS_TOKEN        permanent (system user) access token
 *   WHATSAPP_PHONE_NUMBER_ID     the sending phone number's id
 *   WHATSAPP_BUSINESS_ACCOUNT_ID the WhatsApp Business Account id (to list templates)
 *   WHATSAPP_APP_SECRET          Meta app secret, to verify webhook signatures
 *   WHATSAPP_VERIFY_TOKEN        any string you choose; paste the same into Meta's webhook setup
 *   WHATSAPP_API_VERSION         optional, defaults to v21.0
 *   WHATSAPP_DEFAULT_COUNTRY_CODE optional, for numbers saved without a country code (default 234)
 */

const GRAPH = "https://graph.facebook.com";
export const WINDOW_MS = 24 * 60 * 60 * 1000;

function apiVersion(): string {
  return process.env.WHATSAPP_API_VERSION || "v21.0";
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export function isWindowOpen(lastInboundAt: Date | null | undefined): boolean {
  return Boolean(lastInboundAt && Date.now() - lastInboundAt.getTime() < WINDOW_MS);
}

/**
 * Turns a phone number as people type it into WhatsApp's format: digits only,
 * with country code, no plus. Numbers starting with 0 get the default country
 * code. Returns null if it can't be a real number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const defaultCc = (process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "234").replace(/\D/g, "");
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (hasPlus) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith(defaultCc + "0")) {
    digits = defaultCc + digits.slice(defaultCc.length + 1); // "2340803..." -> "234803..."
  } else if (digits.startsWith("0")) {
    digits = defaultCc + digits.slice(1);
  } else if (digits.length <= 10) {
    digits = defaultCc + digits;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface WhatsAppSendResult {
  ok: boolean;
  waMessageId?: string;
  error?: string;
}

function describeGraphError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: number; error_data?: { details?: string } } };
    const e = parsed.error;
    if (e?.message) {
      const details = e.error_data?.details ? ` ${e.error_data.details}` : "";
      return `WhatsApp ${status}${e.code ? ` (code ${e.code})` : ""}: ${e.message}${details}`;
    }
  } catch {
    // not JSON
  }
  return `WhatsApp ${status}: ${body.slice(0, 300)}`;
}

async function postMessage(payload: Record<string, unknown>): Promise<WhatsAppSendResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    return { ok: false, error: "WhatsApp isn't connected yet (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID missing on the server)." };
  }

  try {
    const res = await fetch(`${GRAPH}/${apiVersion()}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    });
    if (!res.ok) return { ok: false, error: describeGraphError(res.status, await res.text()) };
    const data = (await res.json()) as { messages?: { id: string }[] };
    return { ok: true, waMessageId: data.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Free-text message. WhatsApp only allows this within 24 hours of the person's last message to you. */
export function sendWhatsAppText(to: string, body: string): Promise<WhatsAppSendResult> {
  return postMessage({ to, type: "text", text: { preview_url: false, body } });
}

/** Template parameters can't contain new lines, tabs or runs of 4+ spaces. */
function cleanParam(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim() || "-";
}

/** Approved template message. The only kind WhatsApp lets you start a conversation with. */
export function sendWhatsAppTemplate(to: string, name: string, language: string, params: string[]): Promise<WhatsAppSendResult> {
  return postMessage({
    to,
    type: "template",
    template: {
      name,
      language: { code: language },
      ...(params.length > 0
        ? { components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: cleanParam(p) })) }] }
        : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface WhatsAppTemplateInfo {
  name: string;
  language: string;
  category: string;
  bodyText: string;
  /** number of {{1}}, {{2}}... placeholders in the body */
  variableCount: number;
  supported: boolean;
  unsupportedReason?: string;
}

let templateCache: { at: number; data: WhatsAppTemplateInfo[] } | null = null;

interface GraphTemplate {
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: { type: string; format?: string; text?: string; buttons?: { type: string; url?: string }[] }[];
}

/** Approved templates from the WhatsApp Business Account. Cached for a minute. */
export async function listApprovedTemplates(): Promise<WhatsAppTemplateInfo[]> {
  if (templateCache && Date.now() - templateCache.at < 60_000) return templateCache.data;

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!token || !wabaId) {
    throw new Error("WhatsApp isn't connected yet (WHATSAPP_ACCESS_TOKEN / WHATSAPP_BUSINESS_ACCOUNT_ID missing on the server).");
  }

  const res = await fetch(
    `${GRAPH}/${apiVersion()}/${wabaId}/message_templates?fields=name,language,status,category,components&limit=200`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(describeGraphError(res.status, await res.text()));
  const data = (await res.json()) as { data?: GraphTemplate[] };

  const list = (data.data ?? [])
    .filter((t) => t.status === "APPROVED")
    .map((t): WhatsAppTemplateInfo => {
      const body = t.components?.find((c) => c.type === "BODY")?.text ?? "";
      const header = t.components?.find((c) => c.type === "HEADER");
      const buttons = t.components?.find((c) => c.type === "BUTTONS")?.buttons ?? [];
      const placeholders = Array.from(body.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)).map((m) => m[1]);
      const numeric = placeholders.every((p) => /^\d+$/.test(p));

      let unsupportedReason: string | undefined;
      if (!numeric) unsupportedReason = "Uses named variables";
      else if (header && header.format && header.format !== "TEXT") unsupportedReason = "Has an image, video or document header";
      else if (header?.text && /\{\{/.test(header.text)) unsupportedReason = "Has a variable in the header";
      else if (buttons.some((b) => b.type === "URL" && b.url && /\{\{/.test(b.url))) unsupportedReason = "Has a button with a variable link";

      const maxIndex = numeric ? Math.max(0, ...placeholders.map((p) => parseInt(p, 10))) : 0;
      return {
        name: t.name,
        language: t.language,
        category: t.category ?? "",
        bodyText: body,
        variableCount: maxIndex,
        supported: !unsupportedReason,
        unsupportedReason,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  templateCache = { at: Date.now(), data: list };
  return list;
}

/** Fills {{1}}, {{2}}... in a template body, for showing what was sent. */
export function fillTemplateBody(bodyText: string, params: string[]): string {
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => params[parseInt(n, 10) - 1] ?? "");
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ContactMatch {
  registrationId?: string;
  prospectId?: string;
  name?: string;
}

/** Finds who a phone number belongs to by comparing normalized numbers. */
export async function findContactByWaId(waId: string): Promise<ContactMatch> {
  const [registrations, prospects] = await Promise.all([
    prisma.registration.findMany({ select: { id: true, fullName: true, phone: true } }),
    prisma.prospect.findMany({ where: { phone: { not: null } }, select: { id: true, fullName: true, phone: true } }),
  ]);
  const registration = registrations.find((r) => normalizePhone(r.phone) === waId);
  const prospect = prospects.find((p) => normalizePhone(p.phone) === waId);
  return {
    registrationId: registration?.id,
    prospectId: prospect?.id,
    name: registration?.fullName ?? prospect?.fullName,
  };
}

export async function getOrCreateConversation(waId: string, hint: { name?: string } = {}) {
  const existing = await prisma.whatsAppConversation.findUnique({ where: { waId } });
  if (existing) return existing;

  const match = await findContactByWaId(waId);
  try {
    return await prisma.whatsAppConversation.create({
      data: {
        waId,
        contactName: hint.name ?? match.name ?? null,
        registrationId: match.registrationId,
        prospectId: match.prospectId,
      },
    });
  } catch {
    // Two requests created it at the same moment; use the one that won.
    const again = await prisma.whatsAppConversation.findUnique({ where: { waId } });
    if (again) return again;
    throw new Error("Couldn't create the conversation.");
  }
}

/** Records an outgoing message (sent or failed) on a conversation. */
export async function recordOutbound(params: {
  conversationId: string;
  type: "text" | "template";
  body: string;
  templateName?: string;
  result: WhatsAppSendResult;
  sentByName?: string | null;
  broadcastId?: string;
}) {
  const message = await prisma.whatsAppMessage.create({
    data: {
      conversationId: params.conversationId,
      direction: "OUTBOUND",
      type: params.type,
      body: params.body,
      templateName: params.templateName,
      status: params.result.ok ? "SENT" : "FAILED",
      errorMessage: params.result.ok ? undefined : params.result.error?.slice(0, 500),
      waMessageId: params.result.waMessageId,
      sentByName: params.sentByName ?? undefined,
      broadcastId: params.broadcastId,
    },
  });
  await prisma.whatsAppConversation.update({
    where: { id: params.conversationId },
    data: { lastMessageAt: new Date() },
  });
  return message;
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/** Checks Meta's X-Hub-Signature-256 header. In production a missing app secret rejects everything. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[whatsapp] WHATSAPP_APP_SECRET is not set; rejecting webhook.");
      return false;
    }
    return true;
  }
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const a = new Uint8Array(Buffer.from(provided));
  const b = new Uint8Array(Buffer.from(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

interface WebhookMessage {
  from: string;
  id: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  reaction?: { emoji?: string };
}

interface WebhookStatus {
  id: string;
  status: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}

interface WebhookValue {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WebhookMessage[];
  statuses?: WebhookStatus[];
}

export interface WebhookPayload {
  entry?: { changes?: { field?: string; value?: WebhookValue }[] }[];
}

function inboundBody(m: WebhookMessage): string {
  switch (m.type) {
    case "text":
      return m.text?.body ?? "";
    case "image":
      return m.image?.caption ? `[Photo] ${m.image.caption}` : "[Photo]";
    case "video":
      return m.video?.caption ? `[Video] ${m.video.caption}` : "[Video]";
    case "document":
      return `[Document] ${m.document?.caption ?? m.document?.filename ?? ""}`.trim();
    case "audio":
      return "[Voice message]";
    case "sticker":
      return "[Sticker]";
    case "location":
      return "[Location]";
    case "contacts":
      return "[Contact card]";
    case "button":
      return m.button?.text ?? "[Button reply]";
    case "interactive":
      return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "[Reply]";
    case "reaction":
      return m.reaction?.emoji ? `Reacted ${m.reaction.emoji}` : "[Reaction]";
    default:
      return `[${m.type} message]`;
  }
}

const STATUS_RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };
const STATUS_MAP: Record<string, WhatsAppStatus> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };

/** Stores incoming messages and applies delivery/read updates. Safe to run twice on the same payload. */
export async function processWebhook(payload: WebhookPayload): Promise<{ messages: number; statuses: number }> {
  let messageCount = 0;
  let statusCount = 0;
  const ourNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      if (ourNumberId && value.metadata?.phone_number_id && value.metadata.phone_number_id !== ourNumberId) continue;

      for (const m of value.messages ?? []) {
        const waId = m.from.replace(/\D/g, "");
        if (!waId) continue;

        const duplicate = await prisma.whatsAppMessage.findUnique({ where: { waMessageId: m.id }, select: { id: true } });
        if (duplicate) continue;

        const profileName = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        const conversation = await getOrCreateConversation(waId, { name: profileName });
        const at = m.timestamp ? new Date(parseInt(m.timestamp, 10) * 1000) : new Date();

        // A reaction is not a message that opens the 24-hour window or counts as unread.
        const isReaction = m.type === "reaction";
        await prisma.whatsAppMessage.create({
          data: {
            conversationId: conversation.id,
            direction: "INBOUND",
            type: m.type,
            body: inboundBody(m),
            status: "RECEIVED",
            waMessageId: m.id,
            createdAt: at,
          },
        });
        const update: Prisma.WhatsAppConversationUpdateInput = { lastMessageAt: at };
        if (!isReaction) {
          update.lastInboundAt = at;
          update.unreadCount = { increment: 1 };
        }
        if (!conversation.contactName && profileName) update.contactName = profileName;
        await prisma.whatsAppConversation.update({ where: { id: conversation.id }, data: update });
        messageCount++;
      }

      for (const s of value.statuses ?? []) {
        const next = STATUS_MAP[s.status];
        if (!next) continue;
        const message = await prisma.whatsAppMessage.findUnique({ where: { waMessageId: s.id }, select: { id: true, status: true } });
        if (!message) continue;

        if (next === "FAILED") {
          const e = s.errors?.[0];
          const text = e ? [e.title, e.message, e.error_data?.details].filter(Boolean).join(": ") : "Delivery failed.";
          await prisma.whatsAppMessage.update({
            where: { id: message.id },
            data: { status: "FAILED", errorMessage: `${e?.code ? `(${e.code}) ` : ""}${text}`.slice(0, 500) },
          });
        } else if ((STATUS_RANK[next] ?? 0) > (STATUS_RANK[message.status] ?? -1)) {
          await prisma.whatsAppMessage.update({ where: { id: message.id }, data: { status: next, errorMessage: null } });
        }
        statusCount++;
      }
    }
  }
  return { messages: messageCount, statuses: statusCount };
}
