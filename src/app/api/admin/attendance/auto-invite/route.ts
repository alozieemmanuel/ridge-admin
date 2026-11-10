import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { logAdminAction } from "@/lib/audit";
import { getSettingsMap } from "@/lib/settings";
import { missingEventDetails } from "@/lib/notifications";
import { AUTO_INVITE_NEW_PREFIX } from "@/lib/autoInviteKeys";
import { getAutoInvite, runAutoInvite, setAutoInvite } from "@/lib/autoInvite";

export const runtime = "nodejs";
export const maxDuration = 60;

/** The automatic invitation: is it on, since when, and what the last run did. */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "invitations" });
  if (!ctx.ok) return ctx.response;
  const [state, waiting] = await Promise.all([
    getAutoInvite(ctx.event.id),
    prisma.setting.count({ where: { eventId: ctx.event.id, key: { startsWith: AUTO_INVITE_NEW_PREFIX } } }),
  ]);
  return NextResponse.json({ ...state, waiting, source: ctx.event.dataSource });
}

/** Body: { on: boolean }, or { sendNow: true } to send to whoever is waiting right away. */
export async function PUT(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "invitations" });
  if (!ctx.ok) return ctx.response;
  const { event, session } = ctx;
  let b: { on?: unknown; sendNow?: unknown };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (b.sendNow === true) {
    const r = await runAutoInvite(event.id);
    return NextResponse.json({ result: "success", ...r });
  }
  if (typeof b.on !== "boolean") return NextResponse.json({ error: "Choose on or off." }, { status: 400 });

  if (b.on) {
    const missing = missingEventDetails(await getSettingsMap(event.id));
    if (missing.length) return NextResponse.json({ error: `Fill in the ${missing.join(" and ")} in Settings first. The invitation email needs them.` }, { status: 409 });
  }
  await setAutoInvite(event.id, b.on);
  await logAdminAction(session, { action: "settings.auto_invite", entityType: "data", eventId: event.id, details: { on: b.on } }, request);
  return NextResponse.json({ result: "success", on: b.on });
}
