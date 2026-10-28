import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEvent } from "@/lib/event";
import { finishAttempt, getTestConfig, rewardFor } from "@/lib/tests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** Results for the whole event, best first (ties: the faster finisher). ?format=csv downloads them. */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request, { module: "tests" });
  if (!ctx.ok) return ctx.response;
  const { event } = ctx;
  const config = await getTestConfig(event.id);

  // Any test that ran out of time and was never marked gets marked now.
  const stale = await prisma.testAttempt.findMany({ where: { eventId: event.id, submittedAt: null, deadline: { lte: new Date() } }, select: { id: true } });
  for (const s of stale) await finishAttempt(s.id);

  const [attempts, checkedIn] = await Promise.all([
    prisma.testAttempt.findMany({ where: { eventId: event.id }, include: { registration: { select: { fullName: true, email: true, phone: true, ticketCode: true } } } }),
    prisma.registration.count({ where: { eventId: event.id, checkedInAt: { not: null } } }),
  ]);

  const rows = attempts
    .map((a) => {
      const done = Boolean(a.submittedAt);
      const seconds = a.submittedAt ? Math.max(0, Math.round((a.submittedAt.getTime() - a.startedAt.getTime()) / 1000)) : null;
      return {
        id: a.id,
        name: a.registration.fullName,
        email: a.registration.email,
        phone: a.registration.phone,
        code: a.registration.ticketCode,
        done,
        score: a.score,
        total: a.total,
        seconds,
        startedAt: a.startedAt.toISOString(),
        reward: done ? rewardFor(a.score ?? 0, a.total, config.bands) : null,
      };
    })
    .sort((x, y) => {
      if (x.done !== y.done) return x.done ? -1 : 1;
      if ((y.score ?? 0) !== (x.score ?? 0)) return (y.score ?? 0) - (x.score ?? 0);
      return (x.seconds ?? 0) - (y.seconds ?? 0);
    });
  const ranked = rows.map((r, i) => ({ ...r, rank: r.done ? i + 1 : null }));

  if (request.nextUrl.searchParams.get("format") === "csv") {
    const head = ["Rank", "Name", "Email", "Phone", "Ticket code", "Status", "Score", "Out of", "Percent", "Time (sec)", "Reward"];
    const lines = ranked.map((r) =>
      [r.rank ?? "", r.name, r.email, r.phone, r.code, r.done ? "Finished" : "In progress", r.score ?? "", r.total, r.done && r.total ? Math.round(((r.score ?? 0) / r.total) * 100) : "", r.seconds ?? "", r.reward ?? ""].map(csvCell).join(","),
    );
    return new NextResponse([head.map(csvCell).join(","), ...lines].join("\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${event.slug}-test-results.csv"` },
    });
  }

  return NextResponse.json({ results: ranked, checkedIn, started: attempts.length, finished: attempts.filter((a) => a.submittedAt).length });
}
