import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { clearDataSchema } from "@/lib/validation";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { EDITABLE_TEMPLATE_KEYS } from "@/lib/emailDefaults";

export const runtime = "nodejs";

/**
 * Bulk delete (owner only). Requires { target, confirm: "DELETE" } in the body.
 *
 *   registrations  the whole guest list, with their follow-up logs, email history and tickets.
 *   everything     the guest list AND everything left over from the previous event: the activity log, campaigns,
 *                  email history, brochure requests, prospects, payments, WhatsApp conversations, seats and tables,
 *                  settings and email templates that belong to the old event.
 *
 * Admin accounts (the team), the current Investor Hangout settings and the current email templates are never touched.
 * One entry is written to the (fresh) activity log afterwards, so there is a record of who cleared what.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an owner can clear data." }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = clearDataSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request." }, { status: 400 });
  }
  const { target } = parsed.data;

  if (target === "registrations") {
    const guests = await prisma.registration.deleteMany({});
    await logAdminAction(session, { action: "data.clear", entityType: "data", details: { scope: "registrations", registrations: guests.count } }, request);
    return NextResponse.json({ result: "success", deleted: { registrations: guests.count } });
  }

  // Everything. Children first, so no foreign key ever blocks the delete; all or nothing.
  const keepSettings = Object.keys(DEFAULT_SETTINGS).concat("notification_email");
  const [, , , , , , , , , , , guests, , , oldSettings, oldValues, oldTemplates] = await prisma.$transaction([
    prisma.emailEvent.deleteMany({}),
    prisma.paymentRecord.deleteMany({}),
    prisma.paymentProof.deleteMany({}),
    prisma.followUpNote.deleteMany({}),
    prisma.whatsAppMessage.deleteMany({}),
    prisma.whatsAppConversation.deleteMany({}),
    prisma.whatsAppBroadcast.deleteMany({}),
    prisma.campaign.deleteMany({}),
    prisma.prospect.deleteMany({}),
    prisma.prospectSource.deleteMany({}),
    prisma.seat.deleteMany({}),
    prisma.registration.deleteMany({}),
    prisma.eventTable.deleteMany({}),
    prisma.brochureRequest.deleteMany({}),
    // Settings from the old event (payment, WhatsApp, cohort dates...) go; a current setting is kept unless it still says RIDGE.
    prisma.setting.deleteMany({ where: { key: { notIn: keepSettings } } }),
    prisma.setting.deleteMany({ where: { key: { in: keepSettings }, value: { contains: "ridge", mode: "insensitive" } } }),
    prisma.emailTemplate.deleteMany({ where: { key: { notIn: EDITABLE_TEMPLATE_KEYS } } }),
    prisma.auditLog.deleteMany({}),
  ]);

  await logAdminAction(session, { action: "data.clear", entityType: "data", details: { scope: "everything", registrations: guests.count } }, request);
  return NextResponse.json({
    result: "success",
    deleted: { registrations: guests.count, settings: oldSettings.count + oldValues.count, templates: oldTemplates.count },
  });
}
