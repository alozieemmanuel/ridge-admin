import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import { previewInvitation, sendInvitationTest } from "@/lib/notifications";

export const runtime = "nodejs";

const schema = z.object({
  kind: z.enum(["invitation", "reminder"]),
  /** When given, the email is sent as a test to this address. Otherwise the email is only returned for display. */
  to: z.string().trim().email("Enter a valid email address.").max(320).optional(),
});

/**
 * Shows exactly what "Invite everyone not yet invited" (kind: invitation) or the reminder (kind: reminder) will send, with you as the
 * sample guest, or sends it to one address as a test. Nobody on the list is emailed and nothing is recorded.
 */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "invitations" });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request." }, { status: 400 });
  const { kind, to } = parsed.data;

  if (to) {
    const result = await sendInvitationTest({ eventId: event.id, kind, to, sampleName: session.name });
    if (!result.success) return NextResponse.json({ error: result.error || "The test email could not be sent." }, { status: 502 });
    await logAdminAction(session, { action: "campaign.test", entityType: "campaign", eventId: event.id, details: { to, kind } }, request);
    return NextResponse.json({ result: "sent" });
  }

  const built = await previewInvitation({ eventId: event.id, kind, sampleName: session.name, sampleEmail: session.email });
  return NextResponse.json({ subject: built.subject, html: built.html, replyTo: built.replyTo ?? null });
}
