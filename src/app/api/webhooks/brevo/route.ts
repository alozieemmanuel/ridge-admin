import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { EmailEventType } from "@prisma/client";

export const runtime = "nodejs";

/**
 * Brevo transactional webhook payload (only the fields we use).
 * "message-id" is the same value the send call returned as messageId.
 */
interface BrevoWebhookPayload {
  event?: string;
  "message-id"?: string;
  tags?: string[];
  tag?: string;
}

const EVENT_TYPE_MAP: Record<string, EmailEventType> = {
  delivered: "DELIVERED",
  opened: "OPENED",
  unique_opened: "OPENED",
  uniqueOpened: "OPENED",
  hard_bounce: "BOUNCED",
  hardBounce: "BOUNCED",
  soft_bounce: "BOUNCED",
  softBounce: "BOUNCED",
  blocked: "BOUNCED",
  invalid_email: "BOUNCED",
  invalid: "BOUNCED",
  spam: "COMPLAINED",
  complaint: "COMPLAINED",
};

/**
 * Brevo does not sign webhooks. Instead, add an authentication token to the
 * webhook in Brevo ("Authentication > Token"), which is sent as
 * "Authorization: Bearer <token>", and set the same value in
 * BREVO_WEBHOOK_SECRET. As a fallback for setups that cannot send a header,
 * "?secret=<token>" on the webhook URL is accepted too. If no secret is
 * configured, verification is skipped: fine locally, but set it in production
 * so this endpoint can't be spoofed.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.BREVO_WEBHOOK_SECRET;
  if (!secret) return true;

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : header.trim();
  const provided = bearer || request.nextUrl.searchParams.get("secret") || "";

  const a = new Uint8Array(Buffer.from(provided));
  const b = new Uint8Array(Buffer.from(secret));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function tagValue(tags: string[], name: string): string | undefined {
  const prefix = `${name}:`;
  const found = tags.find((t) => t.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload: BrevoWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const eventType = payload.event ? EVENT_TYPE_MAP[payload.event] : undefined;
  if (!eventType) {
    // Event we don't track (request, click, deferred, ...). We record SENT ourselves.
    return NextResponse.json({ result: "ignored" });
  }

  const messageId = payload["message-id"];
  const tags = payload.tags ?? (payload.tag ? [payload.tag] : []);

  let source = tagValue(tags, "source");
  let id = tagValue(tags, "id");
  let campaignId = tagValue(tags, "campaign");

  // Fall back to the SENT row we wrote at send time if the tags didn't come through.
  if ((!source || !id) && messageId) {
    const sent = await prisma.emailEvent.findFirst({
      where: { providerMessageId: messageId, type: "SENT" },
      orderBy: { occurredAt: "desc" },
    });
    if (sent) {
      source = sent.source === "BROCHURE" ? "brochure" : sent.source === "CAMPAIGN" ? "campaign" : "registration";
      id = sent.registrationId ?? sent.brochureRequestId ?? undefined;
      campaignId = campaignId ?? sent.campaignId ?? undefined;
    }
  }

  if (!source || !id) {
    return NextResponse.json({ result: "ignored", reason: "no correlation" });
  }

  await prisma.emailEvent.create({
    data: {
      source: source === "brochure" ? "BROCHURE" : source === "campaign" ? "CAMPAIGN" : "REGISTRATION",
      audience: "ATTENDEE",
      registrationId: source === "registration" || source === "campaign" ? id : undefined,
      brochureRequestId: source === "brochure" ? id : undefined,
      campaignId: campaignId || undefined,
      type: eventType,
      provider: "BREVO",
      providerMessageId: messageId,
    },
  });

  return NextResponse.json({ result: "success" });
}
