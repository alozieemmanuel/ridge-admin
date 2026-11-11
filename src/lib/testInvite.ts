import { prisma } from "@/lib/prisma";
import { sendTestInvite } from "@/lib/notifications";

/**
 * The welcome and test email, sent when a guest is checked in (door scan, search, walk-in or the Attendance page). It goes out even when the
 * test is not open yet: the guest's personal page tells them it is not open and the button keeps working once the team opens it.
 * It is sent once per guest: checking in again after an undo does not send it again. Never throws, so a failed email cannot hold up the door.
 */
export async function sendTestInviteOnCheckIn(registrationId: string): Promise<"sent" | "skipped" | "failed"> {
  try {
    const person = await prisma.registration.findUnique({ where: { id: registrationId }, include: { event: { select: { modules: true } } } });
    if (!person || !person.checkedInAt || !person.email || !person.event.modules.includes("tests")) return "skipped";
    const already = await prisma.emailEvent.count({ where: { registrationId, kind: "test_invite", type: "SENT" } });
    if (already > 0) return "skipped";
    await sendTestInvite(person);
    return "sent";
  } catch (err) {
    console.error("[test-invite] failed for", registrationId, err instanceof Error ? err.message : err);
    return "failed";
  }
}

/** Guests who are checked in, have an email and have not been sent the welcome and test email yet (for the "send to the rest" button). */
export async function checkedInWithoutTestEmail(eventId: string): Promise<{ ids: string[]; checkedIn: number; emailed: number }> {
  const checked = await prisma.registration.findMany({ where: { eventId, checkedInAt: { not: null }, email: { not: "" } }, select: { id: true } });
  const sent = await prisma.emailEvent.findMany({
    where: { kind: "test_invite", type: "SENT", registrationId: { in: checked.map((c: { id: string }) => c.id) } },
    select: { registrationId: true },
    distinct: ["registrationId"],
  });
  const done = new Set(sent.map((s: { registrationId: string | null }) => s.registrationId));
  return { ids: checked.map((c: { id: string }) => c.id).filter((id: string) => !done.has(id)), checkedIn: checked.length, emailed: done.size };
}
