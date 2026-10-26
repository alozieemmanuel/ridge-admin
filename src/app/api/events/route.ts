import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailDefaults";
import { MODULE_KEYS, slugify, validateSlug } from "@/lib/event";
import { SHEET_INTERVAL_KEY, SHEET_URL_KEY } from "@/lib/contactSheet";
import { cleanColor, cleanLink, cleanTerms, cleanText, cleanTimezone, cleanType } from "@/lib/eventInput";
import { termsOf } from "@/lib/eventTheme";
import { SUPABASE_KEY_KEY, SUPABASE_TABLE_KEY, SUPABASE_URL_KEY, SOURCE_KEYS, cleanSupabaseTable, cleanSupabaseUrl, isDataSource, newIntakeToken } from "@/lib/contactSources";
import { PAY_KEYS, paymentProblem, type PaymentConfig } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StatRow {
  eventId: string;
  total: number;
  invited: number;
  reserved: number;
  checked: number;
  contacted: number;
}

/**
 * The events list. Returns the events this admin can open (owners: all of them, drafts included), each with its brand
 * and the numbers shown on its card. One grouped query does all the counting, so the page stays quick with many events.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const isOwner = session.role === "OWNER";
  const events = await prisma.event.findMany({
    where: isOwner ? {} : { status: { not: "DRAFT" }, admins: { some: { adminId: session.adminId } } },
    orderBy: [{ createdAt: "asc" }],
  });
  const ids = events.map((e) => e.id);

  const [stats, settings] = ids.length
    ? await Promise.all([
        prisma.$queryRaw<StatRow[]>`
          SELECT "eventId",
                 count(*)::int AS total,
                 (count(*) FILTER (WHERE "inviteSentAt" IS NOT NULL OR "reservedAt" IS NOT NULL))::int AS invited,
                 count("reservedAt")::int AS reserved,
                 count("checkedInAt")::int AS checked,
                 (count(*) FILTER (WHERE "followUpStatus" <> 'NOT_CONTACTED'))::int AS contacted
          FROM "Registration"
          WHERE "eventId" = ANY(${ids})
          GROUP BY "eventId"`,
        prisma.setting.findMany({ where: { eventId: { in: ids }, key: { in: ["seat_capacity", "event_date", "event_time", "event_venue", "event_caption", SHEET_URL_KEY, "contacts_sheet_last_sync"] } } }),
      ])
    : [[], []];
  const byEvent = new Map(stats.map((s) => [s.eventId, s]));
  const setting = (eventId: string, key: string) => settings.find((s) => s.eventId === eventId && s.key === key)?.value ?? "";

  return NextResponse.json({
    isOwner,
    events: events.map((e) => {
      const s = byEvent.get(e.id);
      const cap = parseInt(setting(e.id, "seat_capacity"), 10);
      let lastSyncAt: string | null = null;
      try {
        lastSyncAt = JSON.parse(setting(e.id, "contacts_sheet_last_sync") || "null")?.at ?? null;
      } catch {
        lastSyncAt = null;
      }
      return {
        id: e.id,
        slug: e.slug,
        name: e.name,
        brandName: e.brandName,
        color: e.color,
        logoUrl: e.logoUrl,
        logoDarkUrl: e.logoDarkUrl,
        type: e.type,
        dataSource: e.dataSource,
        status: e.status,
        modules: e.modules,
        terms: termsOf(e.terms),
        tagline: setting(e.id, "event_caption"),
        date: setting(e.id, "event_date"),
        time: setting(e.id, "event_time"),
        venue: setting(e.id, "event_venue"),
        sheetLinked: Boolean(setting(e.id, SHEET_URL_KEY)),
        lastSyncAt,
        total: s?.total ?? 0,
        invited: s?.invited ?? 0,
        reserved: s?.reserved ?? 0,
        checkedIn: s?.checked ?? 0,
        contacted: s?.contacted ?? 0,
        capacity: Number.isFinite(cap) && cap > 0 ? cap : null,
        createdAt: e.createdAt.toISOString(),
      };
    }),
  });
}

/**
 * Creates an event (owner only). Body, all optional except name:
 *   name, slug, type, status ("DRAFT" | "ACTIVE"), modules[]
 *   brandName, color (hex), logoUrl, logoDarkUrl (https links; uploads are sent afterwards to /api/admin/event/logo), terms { person, people, action }
 *   timezone, tagline, date, time, venue, capacity, contactEmail, contactPhone, senderName, notificationEmail
 *   sheetUrl, sheetInterval (minutes), copyFrom (event id), adminIds[]
 * The new event starts empty, with its own settings and email templates. "copyFrom" copies another event's settings and email wording.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "OWNER") return NextResponse.json({ error: "Only an owner can create events." }, { status: 403 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = cleanText(b.name, 120);
  if (name.length < 2) return NextResponse.json({ error: "Give the event a name (2 to 120 characters)." }, { status: 400 });

  const slug = (typeof b.slug === "string" && b.slug.trim() ? b.slug.trim().toLowerCase() : slugify(name)).replace(/\s+/g, "-");
  const slugError = validateSlug(slug);
  if (slugError) return NextResponse.json({ error: slugError }, { status: 400 });
  if (await prisma.event.findUnique({ where: { slug }, select: { id: true } })) return NextResponse.json({ error: "Another event already uses that address." }, { status: 409 });

  const color = cleanColor(b.color);
  if (color === undefined) return NextResponse.json({ error: "That colour isn't valid. Use a hex code like #DC2626." }, { status: 400 });
  const logoUrl = cleanLink(b.logoUrl);
  const logoDarkUrl = cleanLink(b.logoDarkUrl);
  if (logoUrl === null || logoDarkUrl === null) return NextResponse.json({ error: "A logo link must start with https://." }, { status: 400 });
  const sheetUrl = typeof b.sheetUrl === "string" ? b.sheetUrl.trim() : "";
  if (sheetUrl && cleanLink(sheetUrl) === null) return NextResponse.json({ error: "The sheet link must start with https://." }, { status: 400 });

  const modules = Array.isArray(b.modules) ? Array.from(new Set(b.modules.filter((m): m is string => typeof m === "string" && MODULE_KEYS.includes(m)))) : [];
  const status = b.status === "DRAFT" ? "DRAFT" : "ACTIVE";
  const brandName = cleanText(b.brandName, 80);
  const capacity = typeof b.capacity === "number" || typeof b.capacity === "string" ? parseInt(String(b.capacity), 10) : NaN;

  // Settings and emails to start from: another event's, or the built-in defaults.
  let settings: Record<string, string> = { ...DEFAULT_SETTINGS };
  let templates: { key: string; subject: string; body: string; replyTo: string | null }[] = DEFAULT_EMAIL_TEMPLATES.map((t) => ({ key: t.key, subject: t.subject, body: t.body, replyTo: t.replyTo ?? null }));
  if (typeof b.copyFrom === "string" && b.copyFrom) {
    const [rows, tpls] = await Promise.all([prisma.setting.findMany({ where: { eventId: b.copyFrom } }), prisma.emailTemplate.findMany({ where: { eventId: b.copyFrom } })]);
    if (rows.length) settings = { ...settings, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
    if (tpls.length) templates = tpls.map((t) => ({ key: t.key, subject: t.subject, body: t.body, replyTo: t.replyTo }));
  }
  // An event's own details never carry over from the one it was copied from.
  for (const k of [SHEET_URL_KEY, "contacts_sheet_last_sync", SHEET_INTERVAL_KEY, "seat_capacity", "event_date", "event_time", "event_venue", ...SOURCE_KEYS, ...PAY_KEYS]) delete settings[k];
  settings.programme_name = name;
  settings.sender_name = cleanText(b.senderName, 80) || brandName || name;
  const set = (key: string, value: string) => {
    if (value) settings[key] = value;
  };
  set("event_caption", cleanText(b.tagline, 120));
  set("event_date", cleanText(b.date, 120));
  set("event_time", cleanText(b.time, 60));
  set("event_venue", cleanText(b.venue, 300));
  set("contact_email", cleanText(b.contactEmail, 200));
  set("contact_phone", cleanText(b.contactPhone, 60));
  set("notification_email", cleanText(b.notificationEmail, 200));
  if (Number.isFinite(capacity) && capacity > 0) settings.seat_capacity = String(capacity);
  else if (b.capacity === "" || b.capacity === null || modules.includes("invitations")) settings.seat_capacity = "";
  if (sheetUrl) {
    settings[SHEET_URL_KEY] = sheetUrl;
    settings[SHEET_INTERVAL_KEY] = String([0, 5, 15, 60].includes(Number(b.sheetInterval)) ? Number(b.sheetInterval) : 5);
  }

  // Where the contacts come from.
  const dataSource = isDataSource(b.dataSource) ? b.dataSource : sheetUrl ? "sheet" : "manual";
  if (dataSource === "supabase") {
    const sb = (b.supabase ?? {}) as { url?: unknown; table?: unknown; key?: unknown };
    const url = cleanSupabaseUrl(String(sb.url ?? ""));
    const table = cleanSupabaseTable(String(sb.table ?? ""));
    const key = typeof sb.key === "string" ? sb.key.trim() : "";
    if (!url || !table || key.length < 20) return NextResponse.json({ error: "Fill in the Supabase project address, the table name and the API key." }, { status: 400 });
    settings[SUPABASE_URL_KEY] = url;
    settings[SUPABASE_TABLE_KEY] = table;
    settings[SUPABASE_KEY_KEY] = key;
    settings[SHEET_INTERVAL_KEY] = String([0, 5, 15, 60].includes(Number(b.sheetInterval)) ? Number(b.sheetInterval) : 5);
  }

  // Price, currency and how guests pay (paid events).
  const type = cleanType(b.type) ?? "free";
  if (type === "paid" && b.payment) {
    const p = b.payment as Partial<PaymentConfig>;
    const cfg: PaymentConfig = { price: String(p.price ?? ""), currency: String(p.currency ?? "NGN"), method: String(p.method ?? "bank"), details: String(p.details ?? "").slice(0, 1000) };
    const problem = paymentProblem(cfg);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    settings.pay_price = cfg.price.replace(/,/g, "").trim();
    settings.pay_currency = cfg.currency;
    settings.pay_method = cfg.method;
    settings.pay_details = cfg.details.trim();
  }

  // Only real, active, non-owner admins can be given access here.
  const adminIds = Array.isArray(b.adminIds) ? b.adminIds.filter((x): x is string => typeof x === "string") : [];
  const admins = adminIds.length ? await prisma.admin.findMany({ where: { id: { in: adminIds }, role: "ADMIN", archivedAt: null }, select: { id: true } }) : [];

  const event = await prisma.event.create({
    data: {
      slug,
      name,
      status,
      modules,
      type,
      dataSource,
      intakeToken: dataSource === "form" ? newIntakeToken() : null,
      brandName: brandName || null,
      color,
      logoUrl: logoUrl || null,
      logoDarkUrl: logoDarkUrl || null,
      terms: { ...cleanTerms(b.terms) },
      timezone: cleanTimezone(b.timezone) ?? "Africa/Lagos",
      settings: { create: Object.entries(settings).map(([key, value]) => ({ key, value })) },
      templates: { create: templates },
      admins: { create: admins.map((a) => ({ adminId: a.id })) },
    },
  });

  await logAdminAction(session, { action: "event.create", entityType: "event", entityId: event.id, entityLabel: name, eventId: event.id, details: { slug, modules, status, type: event.type } }, request);
  return NextResponse.json({ result: "success", event: { id: event.id, slug: event.slug, name: event.name } }, { status: 201 });
}
