import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { getSettingsMap } from "@/lib/settings";
import { missingEventDetails, sendInvitation } from "@/lib/notifications";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Sends reserve links in bulk. Body: { audience: "NOT_INVITED" | "INVITED_NOT_RESERVED", dryRun?: boolean }.
 * NOT_INVITED sends the invitation, INVITED_NOT_RESERVED sends the reminder. Sent a few at a time.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  let raw: { audience?: unknown; dryRun?: unknown };
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const audience = raw.audience;
  if (audience !== "NOT_INVITED" && audience !== "INVITED_NOT_RESERVED") {
    return NextResponse.json({ error: "Choose who to send to." }, { status: 400 });
  }

  const where = audience === "NOT_INVITED" ? { inviteSentAt: null, reservedAt: null } : { inviteSentAt: { not: null }, reservedAt: null };
  const people = await prisma.registration.findMany({ where, orderBy: { createdAt: "asc" } });

  if (raw.dryRun === true) return NextResponse.json({ count: people.length });
  if (people.length === 0) return NextResponse.json({ error: "There is nobody to send to." }, { status: 400 });

  const missing = missingEventDetails(await getSettingsMap());
  if (missing.length) {
    return NextResponse.json({ error: `Fill in the ${missing.join(" and ")} in Settings before sending invitations.` }, { status: 409 });
  }

  const kind = audience === "NOT_INVITED" ? "invitation" : "reminder";
  let sent = 0;
  const failures: { name: string; email: string; error: string }[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < people.length; i += CONCURRENCY) {
    await Promise.all(
      people.slice(i, i + CONCURRENCY).map(async (p) => {
        try {
          await sendInvitation(p, kind);
          sent++;
        } catch (err) {
          failures.push({ name: p.fullName, email: p.email, error: err instanceof Error ? err.message : "Failed" });
        }
      })
    );
  }

  await logAdminAction(
    session,
    { action: "participant.send_invitation", entityType: "data", details: { bulk: true, kind, sent, failed: failures.length } },
    request
  );
  return NextResponse.json({ result: "success", sent, failed: failures.length, failures: failures.slice(0, 20) });
}
