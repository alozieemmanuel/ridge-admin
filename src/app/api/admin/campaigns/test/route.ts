import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireEvent } from "@/lib/event";
import { getSettingsMap } from "@/lib/settings";
import { sendCampaignTest } from "@/lib/notifications";
import { logAdminAction } from "@/lib/audit";

export const runtime = "nodejs";

const schema = z.object({
  subject: z.string().trim().min(1, "Write a subject first.").max(300),
  body: z.string().trim().min(1, "Write the message first.").max(20000),
  to: z.string().trim().email("Enter a valid email address.").max(320),
  ctaLabel: z.string().trim().max(40).optional(),
});

/**
 * Sends a test of the campaign being written to one address. Body: { subject, body, to }.
 * It goes out through the same sender as the real campaign and is marked [TEST].
 * It is not recorded as a campaign and does not touch any contact.
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
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid test." }, { status: 400 });

  const settings = await getSettingsMap(event.id);
  const result = await sendCampaignTest({ to: parsed.data.to, subject: parsed.data.subject, bodyText: parsed.data.body, settings, sampleName: session.name, ctaLabel: parsed.data.ctaLabel || undefined });
  if (!result.success) return NextResponse.json({ error: result.error || "The test email could not be sent." }, { status: 502 });

  await logAdminAction(session, { action: "campaign.test", entityType: "campaign", eventId: event.id, details: { to: parsed.data.to, subject: parsed.data.subject.slice(0, 200) } }, request);
  return NextResponse.json({ result: "success" });
}
