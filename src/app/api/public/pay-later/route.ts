import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonWithCors, preflight } from "@/lib/cors";
import { verifyProofToken } from "@/lib/proof-token";
import { sendPayLaterAcknowledgement } from "@/lib/notifications";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function OPTIONS(request: NextRequest) {
  return preflight(request);
}

/**
 * Saves the date a participant asked to be reminded to pay, then emails them
 * a thank-you and confirmation of that date. Body: { token, date: "YYYY-MM-DD" }.
 * The token is the same signed proofToken handed back at registration.
 */
export async function POST(request: NextRequest) {
  let body: { token?: unknown; date?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonWithCors(request, { error: "Invalid request." }, 400);
  }

  const registrationId = verifyProofToken(String(body.token || ""));
  if (!registrationId) {
    return jsonWithCors(request, { error: "This link isn't valid. Please register again." }, 400);
  }

  const dateText = String(body.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return jsonWithCors(request, { error: "Please choose a reminder date." }, 400);
  }

  // Noon in Lagos (UTC+1) on the chosen day, so the reminder lands in daytime.
  const chosen = new Date(`${dateText}T12:00:00+01:00`);
  if (Number.isNaN(chosen.getTime())) {
    return jsonWithCors(request, { error: "Please choose a valid date." }, 400);
  }

  const now = Date.now();
  if (chosen.getTime() < now - DAY_MS) {
    return jsonWithCors(request, { error: "Please choose a date from today onwards." }, 400);
  }
  if (chosen.getTime() > now + 120 * DAY_MS) {
    return jsonWithCors(request, { error: "Please choose a date within the next 4 months." }, 400);
  }

  const existing = await prisma.registration.findUnique({ where: { id: registrationId } });
  if (!existing) {
    return jsonWithCors(request, { error: "Registration not found." }, 404);
  }

  const registration = await prisma.registration.update({
    where: { id: registrationId },
    data: { payLaterDate: chosen, payLaterReminderAt: null },
  });

  // The save succeeded either way. An email failure is recorded on the
  // registration's email history and doesn't block the participant.
  try {
    await sendPayLaterAcknowledgement(registration);
  } catch (err) {
    console.error("[pay-later] Acknowledgement email failed:", err);
  }

  return jsonWithCors(request, { result: "success" });
}