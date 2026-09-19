import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  const registrations = await prisma.registration.findMany({
    orderBy: { createdAt: "desc" },
    include: { seat: { select: { label: true } } },
  });

  const header = [
    "Full Name",
    "Email",
    "Phone",
    "Country",
    "Organization",
    "Notes",
    "Registration Type",
    "Seat",
    "Payment Status",
    "Amount Paid",
    "Payment Updated At",
    "Registered At",
  ];

  const lines = [header.join(",")];
  for (const r of registrations) {
    lines.push(
      [
        csvEscape(r.fullName),
        csvEscape(r.email),
        csvEscape(r.phone),
        csvEscape(r.country),
        csvEscape(r.organization),
        csvEscape(r.notes),
        csvEscape(r.regType),
        csvEscape(r.seat?.label ?? ""),
        csvEscape(r.paymentStatus),
        csvEscape(r.amountPaid),
        csvEscape(r.paymentUpdatedAt ? r.paymentUpdatedAt.toISOString() : ""),
        csvEscape(r.createdAt.toISOString()),
      ].join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `ridge-registrations-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
