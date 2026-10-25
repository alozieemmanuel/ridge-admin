import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** An uploaded event logo. Public on purpose: emails and the guest's reserve page load it. The address changes (?v=) whenever the file does. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string; variant: string }> }) {
  const { slug, variant } = await params;
  if (variant !== "light" && variant !== "dark") return new NextResponse(null, { status: 404 });
  const event = await prisma.event.findUnique({ where: { slug: slug.toLowerCase() }, select: { id: true } });
  const asset = event ? await prisma.eventAsset.findUnique({ where: { id: `${event.id}:${variant}` } }) : null;
  if (!asset) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(asset.data), {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // An SVG opened on its own cannot run scripts.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
