import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const templates = await prisma.emailTemplate.findMany({ orderBy: { key: "asc" } });
  return NextResponse.json({ templates });
}
