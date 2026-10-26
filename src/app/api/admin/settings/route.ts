import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettingsMap } from "@/lib/settings";
import { updateSettingsSchema } from "@/lib/validation";
import { HIDDEN_SETTING_KEYS } from "@/lib/contactSources";
import { requireEvent } from "@/lib/event";

const DERIVED_KEYS = ["event_slug", "event_name", "event_id", "event_brand_name", "event_color", "event_logo_url", "event_timezone"];

/** The live sheet, Supabase connection and website-form settings have their own screens, not the Event details form. The Supabase key never leaves the server. */
function withoutSheetKeys(settings: Record<string, string>) {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !HIDDEN_SETTING_KEYS.includes(key) && !DERIVED_KEYS.includes(key)));
}

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const settings = withoutSheetKeys(await getSettingsMap(ctx.event.id));
  return NextResponse.json({ settings });
}

export async function PUT(request: NextRequest) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const { event } = ctx;
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

  const entries = Object.entries(parsed.data).filter(([key]) => !HIDDEN_SETTING_KEYS.includes(key) && !DERIVED_KEYS.includes(key));
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { eventId_key: { eventId: event.id, key } },
        update: { value },
        create: { eventId: event.id, key, value },
      })
    )
  );

  // The event's name in the event list follows the "Event name" setting.
  const name = parsed.data.programme_name?.trim();
  if (name && name !== event.name) await prisma.event.update({ where: { id: event.id }, data: { name } });

  const settings = withoutSheetKeys(await getSettingsMap(event.id));
  return NextResponse.json({ result: "success", settings });
}
