import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { clearDataSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Bulk-deletes registrations and/or brochure requests (owner only) — for
 * wiping test data before launch. Requires { confirm: "DELETE" } in the body.
 * Seats held by deleted registrations are released back to OPEN; seats an
 * admin blocked are left alone. Settings, templates and admins are untouched.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an owner can clear data." }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = clearDataSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid request." },
      { status: 400 }
    );
  }

  const { target } = parsed.data;
  let registrations = 0;
  let brochureRequests = 0;

  if (target === "registrations" || target === "all") {
    const [, deleted] = await prisma.$transaction([
      prisma.seat.updateMany({
        where: { registrationId: { not: null } },
        data: { status: "OPEN", registrationId: null, holdExpiresAt: null },
      }),
      prisma.registration.deleteMany({}),
    ]);
    registrations = deleted.count;
  }

  if (target === "brochure_requests" || target === "all") {
    brochureRequests = (await prisma.brochureRequest.deleteMany({})).count;
  }

  return NextResponse.json({ result: "success", deleted: { registrations, brochureRequests } });
}
