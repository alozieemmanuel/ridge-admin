import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { INTAKE_ORIGINS_KEY, addOrUpdateContact, tokenMatches } from "@/lib/contactSources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The address an event's website form posts to:   POST /event/api/public/intake/<event-slug>
 * It needs the event's secret key, sent as the header "x-intake-key", as "Authorization: Bearer <key>", or as a form field / query
 * value named "key". The registration is added to the event's contacts at once. Nobody is emailed by this.
 *
 * Fields (JSON or a normal HTML form): name (or full_name, or first_name + last_name), email, phone. Every other field is kept
 * on the contact as an extra detail. A field named "website" is a trap for bots: when it is filled in, nothing is saved.
 * The key is visible to anyone who views the form's source. It stops random posts, not a determined one, so the endpoint
 * also limits how fast one address can post, and the owner can change the key at any time (Settings, Contacts source).
 */

const RESERVED_FIELDS = new Set(["key", "token", "website", "_gotcha", "_redirect", "x-intake-key"]);
const hits = new Map<string, { n: number; reset: number }>();

function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return false;
  }
  h.n++;
  return h.n > 20;
}

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-intake-key, authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (!allowed.length) h["Access-Control-Allow-Origin"] = "*";
  else if (origin && allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function parseOrigins(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter((o) => /^https?:\/\//.test(o));
}

async function originsFor(slug: string): Promise<string[]> {
  const event = await prisma.event.findUnique({ where: { slug }, select: { id: true } });
  if (!event) return [];
  const row = await prisma.setting.findUnique({ where: { eventId_key: { eventId: event.id, key: INTAKE_ORIGINS_KEY } } });
  return parseOrigins(row?.value);
}

export async function OPTIONS(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin"), await originsFor(slug.toLowerCase())) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug.toLowerCase();
  const event = await prisma.event.findUnique({ where: { slug }, select: { id: true, status: true, dataSource: true, intakeToken: true } });
  const allowed = event ? parseOrigins((await prisma.setting.findUnique({ where: { eventId_key: { eventId: event.id, key: INTAKE_ORIGINS_KEY } } }))?.value) : [];
  const cors = corsHeaders(request.headers.get("origin"), allowed);
  const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: cors });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (limited(ip)) return reply({ error: "Too many submissions. Try again in a minute." }, 429);

  // The same answer for "no such event", "form not switched on" and "wrong key", so nothing is revealed.
  const denied = () => reply({ error: "Not allowed." }, 403);
  if (!event || event.status !== "ACTIVE" || event.dataSource !== "form" || !event.intakeToken) return denied();

  const type = request.headers.get("content-type") ?? "";
  let fields: Record<string, string> = {};
  try {
    if (type.includes("application/json")) {
      const json = (await request.json()) as Record<string, unknown>;
      for (const [k, v] of Object.entries(json ?? {})) if (v !== null && typeof v !== "object") fields[k] = String(v);
    } else {
      const form = await request.formData();
      for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
    }
  } catch {
    return reply({ error: "Could not read the form." }, 400);
  }

  const given = request.headers.get("x-intake-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || fields.key || fields.token || request.nextUrl.searchParams.get("key") || "";
  if (!tokenMatches(given, event.intakeToken)) return denied();

  // Bots fill every field. Pretend it worked.
  if (fields.website || fields._gotcha) return reply({ ok: true });

  const pick = (...names: string[]) => {
    for (const n of names) {
      const hit = Object.keys(fields).find((k) => k.toLowerCase().replace(/[\s_-]+/g, "") === n);
      if (hit && fields[hit].trim()) return fields[hit].trim();
    }
    return "";
  };
  const first = pick("firstname", "givenname");
  const last = pick("lastname", "surname", "familyname");
  const fullName = (pick("name", "fullname", "guestname", "yourname") || [first, last].filter(Boolean).join(" ")).slice(0, 200);
  const email = pick("email", "emailaddress", "youremail");
  const phone = pick("phone", "phonenumber", "mobile", "mobilenumber", "whatsapp", "whatsappnumber", "tel").slice(0, 60);

  const used = new Set(["name", "fullname", "guestname", "yourname", "firstname", "givenname", "lastname", "surname", "familyname", "email", "emailaddress", "youremail", "phone", "phonenumber", "mobile", "mobilenumber", "whatsapp", "whatsappnumber", "tel"]);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (Object.keys(extra).length >= 30) break;
    if (RESERVED_FIELDS.has(k.toLowerCase()) || used.has(k.toLowerCase().replace(/[\s_-]+/g, "")) || !v.trim()) continue;
    extra[k.slice(0, 80)] = v.trim().slice(0, 500);
  }

  const saved = await addOrUpdateContact(event.id, { fullName, email, phone, extra }, "Website form");
  if ("error" in saved) return reply({ error: saved.error }, 400);

  // A normal HTML form can ask to be sent back to a page of the website, but only to an address the owner has allowed.
  const back = fields._redirect;
  if (back && !type.includes("application/json")) {
    try {
      const target = new URL(back);
      if (allowed.includes(target.origin)) return NextResponse.redirect(target.toString(), { status: 303, headers: cors });
    } catch {
      // ignore a bad address
    }
  }
  return reply({ ok: true, result: saved.result });
}
