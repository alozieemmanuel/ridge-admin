import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  // internal_* rows (from older seeds) are no longer used — internal team
  // alerts are built into the system — so they're hidden from the editor.
  const templates = await prisma.emailTemplate.findMany({
    where: { NOT: { key: { startsWith: "internal_" } } },
    orderBy: { key: "asc" },
  });
  return NextResponse.json({ templates });
}
