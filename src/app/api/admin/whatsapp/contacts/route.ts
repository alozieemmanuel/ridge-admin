import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { normalizePhone } from "@/lib/whatsapp";

export const runtime = "nodejs";

/** Finds registrants and prospects by name, email or phone, for starting a new chat. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ contacts: [] });

  const [registrations, prospects] = await Promise.all([
    prisma.registration.findMany({
      where: { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] },
      select: { fullName: true, phone: true },
      take: 8,
    }),
    prisma.prospect.findMany({
      where: {
        phone: { not: null },
        OR: [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }],
      },
      select: { fullName: true, phone: true },
      take: 8,
    }),
  ]);

  const contacts = [
    ...registrations.map((r) => ({ name: r.fullName, phone: r.phone, kind: "Registered" })),
    ...prospects.map((p) => ({ name: p.fullName, phone: p.phone ?? "", kind: "Prospect" })),
  ]
    .filter((c) => normalizePhone(c.phone))
    .slice(0, 12);

  return NextResponse.json({ contacts });
}
