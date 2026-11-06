import { NextRequest, NextResponse } from "next/server";
import { sendCampaignSchema } from "@/lib/validation";
import { requireEvent } from "@/lib/event";
import { CampaignSendError, prepareMailchimpCampaign, executeMailchimpCampaign } from "@/lib/campaignRun";
import type { SendEvent, SendProgress } from "@/lib/sendProgress";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Sends a broadcast through Mailchimp's own campaigns. The guests are added to the Mailchimp audience and Mailchimp sends
 * one campaign to them. Mailchimp leaves out anyone who has unsubscribed there. People who already got the same email from
 * this dashboard are left out, like on the normal send.
 */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "campaigns" });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = sendCampaignSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payload." }, { status: 400 });
  const { audience, subject, body, ctaLabel } = parsed.data;

  let prepared;
  try {
    prepared = await prepareMailchimpCampaign(event, session.name, { audience, subject, body, ctaLabel: ctaLabel ?? null, category: parsed.data.category || null });
  } catch (err) {
    if (err instanceof CampaignSendError) return NextResponse.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, { status: err.status });
    throw err;
  }

  // The answer is streamed, one JSON object per line: progress while it works, then "done" or "error".
  // This lets the Campaigns page show what is happening instead of a spinner that never ends.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (e: SendEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          // The page was closed. The send carries on on the server.
        }
      };
      const progress = (p: SendProgress) => write({ type: "progress", progress: p });
      try {
        write({ type: "done", result: await executeMailchimpCampaign(prepared, progress) });
      } catch (err) {
        write({ type: "error", error: err instanceof Error ? err.message : String(err) });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
