import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listApprovedTemplates } from "@/lib/whatsapp";

export const runtime = "nodejs";

/** Approved WhatsApp message templates from the Business Account. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    return NextResponse.json({ templates: await listApprovedTemplates() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load templates.", templates: [] }, { status: 502 });
  }
}
