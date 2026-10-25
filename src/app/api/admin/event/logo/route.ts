import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit";
import { requireEvent } from "@/lib/event";

export const runtime = "nodejs";

const MAX_BYTES = 1_500_000;

/** What the file really is, judged from its first bytes (the name and the browser's type are not trusted). */
function sniff(bytes: Uint8Array): string | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  const head = new TextDecoder().decode(bytes.slice(0, 400)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

/**
 * Uploads the event's logo (owner only). Form data: file, variant = "light" (the normal logo) or "dark" (the white logo for dark mode).
 * PNG, JPG, WebP or SVG, up to 1.5 MB. The file is stored in the database, so no file storage has to be set up.
 */
export async function POST(request: NextRequest) {
  const ctx = await requireEvent(request, { owner: true });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const variant = form?.get("variant") === "dark" ? "dark" : "light";
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image file." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That image is too large. Use one under 1.5 MB." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes);
  if (!type) return NextResponse.json({ error: "Use a PNG, JPG, WebP or SVG image." }, { status: 400 });
  if (type === "image/svg+xml") {
    const text = new TextDecoder().decode(bytes).toLowerCase();
    if (/<script|\son[a-z]+\s*=|javascript:|<foreignobject/.test(text)) return NextResponse.json({ error: "That SVG contains code and can't be used. Export it as a PNG." }, { status: 400 });
  }

  const id = `${event.id}:${variant}`;
  await prisma.eventAsset.upsert({ where: { id }, update: { contentType: type, data: Buffer.from(bytes) }, create: { id, eventId: event.id, variant, contentType: type, data: Buffer.from(bytes) } });
  const url = `/api/public/event-logo/${event.slug}/${variant}?v=${Date.now()}`;
  await prisma.event.update({ where: { id: event.id }, data: variant === "dark" ? { logoDarkUrl: url } : { logoUrl: url } });

  await logAdminAction(session, { action: "event.update", entityType: "event", entityId: event.id, entityLabel: event.name, eventId: event.id, details: { logo: variant, uploaded: true } }, request);
  return NextResponse.json({ result: "success", url });
}

/** Removes the event's logo. Query: variant=light|dark. */
export async function DELETE(request: NextRequest) {
  const ctx = await requireEvent(request, { owner: true });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;
  const variant = request.nextUrl.searchParams.get("variant") === "dark" ? "dark" : "light";
  await prisma.eventAsset.deleteMany({ where: { id: `${event.id}:${variant}` } });
  await prisma.event.update({ where: { id: event.id }, data: variant === "dark" ? { logoDarkUrl: null } : { logoUrl: null } });
  await logAdminAction(session, { action: "event.update", entityType: "event", entityId: event.id, entityLabel: event.name, eventId: event.id, details: { logo: variant, removed: true } }, request);
  return NextResponse.json({ result: "success" });
}
