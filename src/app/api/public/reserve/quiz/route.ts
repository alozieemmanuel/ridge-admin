import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyReserveToken } from "@/lib/proof-token";
import { quizState, startQuiz, submitQuiz } from "@/lib/entryQuiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The short quiz before reserving. Body: { t, action: "start" } returns the guest's own questions; { t, action: "submit", answers } marks it. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const id = verifyReserveToken(String(body.t || ""));
  if (!id) return NextResponse.json({ error: "This link isn't valid." }, { status: 400 });
  const reg = await prisma.registration.findUnique({ where: { id } });
  if (!reg) return NextResponse.json({ error: "We couldn't find your invitation." }, { status: 404 });
  if (reg.reservedAt) return NextResponse.json({ error: "Your seat is already reserved." }, { status: 409 });

  const st = await quizState(reg);
  if (!st.enabled) return NextResponse.json({ error: "There is no quiz for this event." }, { status: 404 });
  if (!st.required) return NextResponse.json({ state: st });

  if (st.locked) return NextResponse.json({ error: "You have used all your tries.", state: st }, { status: 403 });

  if (body.action === "submit") {
    if (reg.quizAt) return NextResponse.json({ error: "This quiz was already submitted. Start again to retry." }, { status: 409 });
    const res = await submitQuiz(reg, typeof body.answers === "object" && body.answers ? body.answers : {});
    if (!res) return NextResponse.json({ error: "Start the quiz first." }, { status: 409 });
    const fresh = await prisma.registration.findUnique({ where: { id } });
    return NextResponse.json({ state: await quizState(fresh!) });
  }
  const paper = await startQuiz(reg, st.count);
  return NextResponse.json({ paper, state: st });
}
