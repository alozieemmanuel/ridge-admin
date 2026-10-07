import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";

export const runtime = "nodejs";

type RecipientStatus = "FAILED" | "SENT" | "DELIVERED" | "OPENED" | "BOUNCED" | "COMPLAINED";

// Higher wins when a recipient has several events (opened beats delivered beats sent).
const RANK: Record<RecipientStatus, number> = { FAILED: 0, SENT: 1, DELIVERED: 2, OPENED: 3, BOUNCED: 4, COMPLAINED: 5 };

/**
 * One campaign in full: what was sent (subject and message), the counts, and one row per
 * recipient with how far their email got. Recipients are paged (page, pageSize up to 200) and
 * can be searched by name or email. Queries run one after another because the database pool
 * is small.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search")?.trim().toLowerCase() || "";
  const statusFilter = searchParams.get("status") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "25", 10) || 25));

  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  const events = await prisma.emailEvent.findMany({
    where: { campaignId: id, source: "CAMPAIGN", registrationId: { not: null } },
    select: { registrationId: true, type: true, occurredAt: true, errorMessage: true },
    orderBy: { occurredAt: "asc" },
  });

  interface Row {
    registrationId: string;
    status: RecipientStatus;
    sentAt: string | null;
    deliveredAt: string | null;
    openedAt: string | null;
    error: string | null;
  }
  const byRecipient = new Map<string, Row>();
  // Counted per person, like the campaigns list: five opens by one person is one open.
  const totals = { delivered: 0, opened: 0, bounced: 0, complained: 0 };
  for (const e of events) {
    const rid = e.registrationId as string;
    const row =
      byRecipient.get(rid) ??
      ({ registrationId: rid, status: "FAILED", sentAt: null, deliveredAt: null, openedAt: null, error: null } as Row);
    const at = e.occurredAt.toISOString();
    if (e.type === "SENT" && !row.sentAt) row.sentAt = at;
    if (e.type === "DELIVERED" && !row.deliveredAt) row.deliveredAt = at;
    if (e.type === "OPENED" && !row.openedAt) row.openedAt = at;
    if (e.type === "FAILED") row.error = e.errorMessage ?? "Could not be sent.";
    if (RANK[e.type as RecipientStatus] >= RANK[row.status]) row.status = e.type as RecipientStatus;
    byRecipient.set(rid, row);
  }
  for (const r of byRecipient.values()) {
    if (r.deliveredAt) totals.delivered++;
    if (r.openedAt) totals.opened++;
  }
  const bouncedIds = new Set(events.filter((e) => e.type === "BOUNCED").map((e) => e.registrationId));
  const complainedIds = new Set(events.filter((e) => e.type === "COMPLAINED").map((e) => e.registrationId));
  totals.bounced = bouncedIds.size;
  totals.complained = complainedIds.size;

  const ids = Array.from(byRecipient.keys());
  const people = ids.length
    ? await prisma.registration.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } })
    : [];
  const personById = new Map(people.map((p) => [p.id, p]));

  let rows = ids
    .map((rid) => ({ ...byRecipient.get(rid)!, fullName: personById.get(rid)?.fullName ?? "", email: personById.get(rid)?.email ?? "" }))
    .filter((r) => r.email !== "");
  if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
  if (search) rows = rows.filter((r) => r.fullName.toLowerCase().includes(search) || r.email.toLowerCase().includes(search));
  rows.sort((a, b) => a.fullName.localeCompare(b.fullName));

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      subject: campaign.subject,
      body: campaign.body,
      audience: campaign.audience,
      category: campaign.category,
      recipientCount: campaign.recipientCount,
      sentCount: campaign.sentCount,
      failedCount: campaign.failedCount,
      sentAt: campaign.sentAt.toISOString(),
      sentByName: campaign.sentByName,
      ...totals,
    },
    total: rows.length,
    page,
    pageSize,
    recipients: rows.slice((page - 1) * pageSize, page * pageSize),
  });
}

/** Owner only. Removes the campaign and, with it, its delivery events (they cascade). Emails already sent can't be recalled. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an owner can delete campaigns." }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.campaign.findUnique({
    where: { id },
    select: { id: true, subject: true, audience: true, sentCount: true, recipientCount: true },
  });
  if (!existing) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  await prisma.campaign.delete({ where: { id } });

  await logAdminAction(
    session,
    {
      action: "campaign.delete",
      entityType: "campaign",
      entityId: id,
      entityLabel: existing.subject,
      details: { audience: existing.audience, sentCount: existing.sentCount, recipientCount: existing.recipientCount },
    },
    request
  );

  return NextResponse.json({ result: "success" });
}
