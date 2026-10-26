import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { SENDER_KINDS, isSenderKind, poolStatus, savePool, startOfTomorrow, type SenderKind } from "@/lib/senders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The sender pool with what each sender has sent today, and how many campaign emails are waiting for tomorrow. Any signed-in admin. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const [senders, waiting] = await Promise.all([poolStatus(), prisma.queuedEmail.count({ where: { status: "PENDING" } })]);
  return NextResponse.json({
    senders,
    waiting,
    resetsAt: startOfTomorrow().toISOString(),
    isOwner: session.role === "OWNER",
    available: SENDER_KINDS.map((k) => ({ kind: k.kind, name: k.name, needs: k.env, suggestedLimit: k.suggestedLimit, note: k.note })),
  });
}

/** Owner only. Body: { senders: [{ kind, dailyLimit, enabled }] } in order of preference. Replaces the whole list. */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.role !== "OWNER") return NextResponse.json({ error: "Only an owner can change the senders." }, { status: 403 });

  let body: { senders?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!Array.isArray(body.senders) || body.senders.length > SENDER_KINDS.length) return NextResponse.json({ error: "Invalid list." }, { status: 400 });

  const items: { kind: SenderKind; dailyLimit: number; enabled: boolean }[] = [];
  for (const raw of body.senders) {
    const r = (raw ?? {}) as { kind?: unknown; dailyLimit?: unknown; enabled?: unknown };
    if (!isSenderKind(r.kind)) return NextResponse.json({ error: "Unknown sender." }, { status: 400 });
    const limit = Number(r.dailyLimit);
    if (!Number.isFinite(limit) || limit < 0 || limit > 10_000_000) return NextResponse.json({ error: "A daily limit must be a number from 0 up. Use 0 for no limit." }, { status: 400 });
    items.push({ kind: r.kind, dailyLimit: Math.floor(limit), enabled: r.enabled !== false });
  }

  await savePool(items);
  await logAdminAction(session, { action: "senders.update", entityType: "sender", entityLabel: items.map((i) => i.kind).join(", ") || "none", eventId: null, details: { count: items.length } }, request);
  const [senders, waiting] = await Promise.all([poolStatus(), prisma.queuedEmail.count({ where: { status: "PENDING" } })]);
  return NextResponse.json({ result: "success", senders, waiting });
}
