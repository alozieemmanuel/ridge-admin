import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { SHEET_URL_KEY } from "@/lib/contactSheet";
import { pingKeyIsValid, requestSheetSync } from "@/lib/sheetPing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called by the event's Google Sheet script when a row is added. It answers at once and reads the sheet in the background,
 * so registrations on the website are never held up. The key in the address belongs to this event only.
 */
async function ping(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await prisma.event.findUnique({ where: { slug: slug.toLowerCase() }, select: { id: true, status: true, dataSource: true } });
  // The same answer for a wrong event and a wrong key, so addresses cannot be guessed.
  if (!event || !pingKeyIsValid(event.id, request.nextUrl.searchParams.get("key") || "")) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (event.status !== "ACTIVE" || event.dataSource !== "sheet") return NextResponse.json({ ok: false, reason: "This event does not read a live sheet." }, { status: 409 });
  const linked = await prisma.setting.findFirst({ where: { eventId: event.id, key: SHEET_URL_KEY, value: { not: "" } }, select: { eventId: true } });
  if (!linked) return NextResponse.json({ ok: false, reason: "No sheet is linked yet." }, { status: 409 });

  after(() => requestSheetSync(event.id));
  return NextResponse.json({ ok: true }, { status: 202 });
}

export const GET = ping;
export const POST = ping;
