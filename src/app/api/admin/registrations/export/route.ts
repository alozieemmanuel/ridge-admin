import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { followUpLabel } from "@/lib/followUp";
import { requireEvent } from "@/lib/event";

export const runtime = "nodejs";

function csvEscape(value: unknown): string {
  let str = value === null || value === undefined ? "" : String(value);
  // A cell that starts with = + - @ would be run as a formula by Excel, so it is made plain text.
  if (/^[=+\-@\t\r]/.test(str) && !/^\+?\d[\d\s-]*$/.test(str)) str = `'${str}`;
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** The event's whole contact list as a CSV (what Excel and Google Sheets open). The link carries ?event=<slug>. */
export async function GET(request: NextRequest) {
  const ctx = await requireEvent(request);
  if (!ctx.ok) return ctx.response;
  const { event } = ctx;
  const people = await prisma.registration.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: "desc" },
    include: { followUpNotes: { orderBy: { createdAt: "asc" } } },
  });

  const extraHeaders = Array.from(new Set(people.flatMap((p) => Object.keys((p.extra as Record<string, string> | null) ?? {}))));
  const header = [
    "Full Name",
    "Email",
    "Phone",
    "Follow-up",
    "Follow-up log",
    "Invitation Sent",
    "Seat Reserved",
    "Reserved At",
    "Ticket Code",
    "Checked In At",
    "Added At",
    ...extraHeaders,
  ];

  const lines = [header.map(csvEscape).join(",")];
  for (const p of people) {
    const extra = (p.extra as Record<string, string> | null) ?? {};
    lines.push(
      [
        p.fullName,
        p.email,
        p.phone,
        followUpLabel(p.followUpStatus),
        p.followUpNotes
          .map((n) => `${n.createdAt.toISOString().slice(0, 10)}${n.authorName ? ` (${n.authorName})` : ""} [${followUpLabel(n.status)}]${n.body ? `: ${n.body}` : ""}`)
          .join(" | "),
        p.inviteSentAt ? p.inviteSentAt.toISOString() : "",
        p.reservedAt ? "Yes" : "No",
        p.reservedAt ? p.reservedAt.toISOString() : "",
        p.ticketCode,
        p.checkedInAt ? p.checkedInAt.toISOString() : "",
        p.createdAt.toISOString(),
        ...extraHeaders.map((h) => extra[h] ?? ""),
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const filename = `${event.slug}-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse("﻿" + lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
