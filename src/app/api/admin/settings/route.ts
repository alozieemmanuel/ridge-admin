import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettingsMap } from "@/lib/settings";
import { updateSettingsSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  const settings = await getSettingsMap();
  return NextResponse.json({ settings });
}

export async function PUT(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = updateSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings payload." }, { status: 400 });
  }

  const entries = Object.entries(parsed.data);
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  );

  const settings = await getSettingsMap();
  return NextResponse.json({ result: "success", settings });
}
