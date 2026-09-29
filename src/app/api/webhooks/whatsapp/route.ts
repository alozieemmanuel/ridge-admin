import { NextRequest, NextResponse } from "next/server";
import { processWebhook, verifyWebhookSignature, type WebhookPayload } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Meta calls this once with GET when you save the webhook in the developer
 * console; answer with the challenge if the verify token matches.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;

  if (expected && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === expected) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed." }, { status: 403 });
}

/** Incoming messages and delivery/read updates. */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    const counts = await processWebhook(payload);
    return NextResponse.json({ result: "success", ...counts });
  } catch (err) {
    // Non-2xx makes Meta retry, which is what we want for a temporary database problem.
    console.error("[whatsapp] Webhook processing failed:", err);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}
