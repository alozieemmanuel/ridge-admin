import { NextRequest, NextResponse } from "next/server";
import { requireEvent } from "@/lib/event";
import { listApprovedTemplates } from "@/lib/whatsapp";

export const runtime = "nodejs";

/** Approved WhatsApp message templates from the company's WhatsApp Business Account (shared by all events). */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "whatsapp" });
  if (!ctx.ok) return ctx.response;

  try {
    return NextResponse.json({ templates: await listApprovedTemplates() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load templates.", templates: [] }, { status: 502 });
  }
}
