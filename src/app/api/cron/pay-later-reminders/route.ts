import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPayLaterReminder } from "@/lib/notifications";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Runs once a day (see vercel.json). Sends the payment reminder to everyone
 * whose chosen date has arrived, who hasn't paid in full, and who hasn't
 * already been reminded. Vercel calls this with the CRON_SECRET as a bearer
 * token, so the endpoint can't be triggered by anyone else.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const due = await prisma.registration.findMany({
    where: {
      payLaterDate: { lte: new Date() },
      payLaterReminderAt: null,
      paymentStatus: { not: "PAID" },
    },
    take: 200,
  });

  let sent = 0;
  let failed = 0;
  for (const registration of due) {
    try {
      await sendPayLaterReminder(registration);
      sent++;
    } catch (err) {
      failed++;
      console.error("[cron] Pay-later reminder failed for", registration.id, err);
    }
  }

  return NextResponse.json({ result: "success", due: due.length, sent, failed });
}