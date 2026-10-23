import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettingsMap } from "@/lib/settings";
import { updateSettingsSchema } from "@/lib/validation";
import { SHEET_KEYS } from "@/lib/contactSheet";

/** The live sheet link and its last result are managed from the Contacts page, not the Event details form. */
function withoutSheetKeys(settings: Record<string, string>) {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !SHEET_KEYS.includes(key)));
}

export const runtime = "nodejs";

export async function GET() {
  const settings = withoutSheetKeys(await getSettingsMap());
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

  const entries = Object.entries(parsed.data).filter(([key]) => !SHEET_KEYS.includes(key));
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  );

  const settings = withoutSheetKeys(await getSettingsMap());
  return NextResponse.json({ result: "success", settings });
}
