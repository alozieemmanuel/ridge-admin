import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LOGO_URL } from "@/lib/brand";

export const runtime = "nodejs";

/**
 * The logo for emails: the event's logo on a white rounded plate, as one PNG. Mail apps in dark mode (Gmail's app, for example)
 * turn the page dark but leave pictures alone, so a dark logo on a transparent background disappears. On its own white plate it
 * stays readable in both modes. The address changes (?v=) whenever the logo does.
 */
async function sourceBuffer(slug: string): Promise<Buffer | null> {
  const event = await prisma.event.findUnique({ where: { slug: slug.toLowerCase() }, select: { id: true, logoUrl: true } });
  const src = event?.logoUrl || LOGO_URL;
  // An uploaded logo lives in the database.
  const uploaded = /\/api\/public\/event-logo\/[^/]+\/(light|dark)/.exec(src);
  if (event && uploaded) {
    const asset = await prisma.eventAsset.findUnique({ where: { id: `${event.id}:${uploaded[1]}` } });
    return asset ? Buffer.from(asset.data) : null;
  }
  if (!/^https:\/\//i.test(src)) return null;
  const res = await fetch(src, { signal: AbortSignal.timeout(7000) });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const input = await sourceBuffer(slug);
    if (!input) throw new Error("no logo");
    const sharp = (await import("sharp")).default;
    const pad = 28;
    const inner = await sharp(input).resize({ width: 360, withoutEnlargement: false }).flatten({ background: "#ffffff" }).png().toBuffer();
    const meta = await sharp(inner).metadata();
    const w = (meta.width ?? 360) + pad * 2;
    const h = (meta.height ?? 120) + pad * 2;
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="26" ry="26" fill="#fff"/></svg>`);
    const png = await sharp({ create: { width: w, height: h, channels: 4, background: "#ffffff" } })
      .composite([{ input: inner, left: pad, top: pad }, { input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
    return new NextResponse(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800, s-maxage=604800" } });
  } catch {
    // Never leave a broken picture in an email: fall back to the plain logo.
    const event = await prisma.event.findUnique({ where: { slug: slug.toLowerCase() }, select: { logoUrl: true } }).catch(() => null);
    const plain = event?.logoUrl && /^https:\/\//i.test(event.logoUrl) ? event.logoUrl : LOGO_URL;
    return NextResponse.redirect(plain, 302);
  }
}
