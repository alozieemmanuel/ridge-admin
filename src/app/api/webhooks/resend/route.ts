import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { EmailEventType } from "@prisma/client";

export const runtime = "nodejs";

interface ResendWebhookPayload {
  type: string;
  data: {
    email_id?: string;
    tags?: { name: string; value: string }[];
  };
}

const EVENT_TYPE_MAP: Record<string, EmailEventType> = {
  "email.delivered": "DELIVERED",
  "email.opened": "OPENED",
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINED",
  "email.delivery_delayed": "SENT",
};

/**
 * Verifies a Resend (Svix-format) webhook signature. secret is the
 * RESEND_WEBHOOK_SECRET value, formatted "whsec_<base64>". If no secret is
 * configured, verification is skipped — fine for local development, but set
 * RESEND_WEBHOOK_SECRET in production so this endpoint can't be spoofed.
 */
function verifySignature(rawBody: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return true;

  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");

  const provided = svixSignature
    .split(" ")
    .map((part) => part.split(",")[1])
    .filter(Boolean);

  return provided.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const eventType = EVENT_TYPE_MAP[payload.type];
  if (!eventType) {
    // Event we don't track (e.g. email.sent — we already record SENT ourselves).
    return NextResponse.json({ result: "ignored" });
  }

  const tags = payload.data.tags ?? [];
  const source = tags.find((t) => t.name === "source")?.value;
  const id = tags.find((t) => t.name === "id")?.value;
  const campaignId = tags.find((t) => t.name === "campaign")?.value;

  if (!source || !id) {
    return NextResponse.json({ result: "ignored", reason: "no correlation tags" });
  }

  await prisma.emailEvent.create({
    data: {
      source: source === "brochure" ? "BROCHURE" : source === "campaign" ? "CAMPAIGN" : "REGISTRATION",
      audience: "ATTENDEE",
      registrationId: source === "registration" || source === "campaign" ? id : undefined,
      brochureRequestId: source === "brochure" ? id : undefined,
      campaignId: campaignId || undefined,
      type: eventType,
      providerMessageId: payload.data.email_id,
    },
  });

  return NextResponse.json({ result: "success" });
}
