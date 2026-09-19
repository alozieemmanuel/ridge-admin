"use client";

import Link from "next/link";

const SUB_TABS: { href: string; label: string }[] = [
  { href: "/admin/seats", label: "Manage seats" },
  { href: "/admin/seats/bookings", label: "Bookings" },
  { href: "/admin/seats/attendance", label: "Attendance" },
];

export default function SeatsSubNav({ active }: { active: string }) {
  return (
    <div className="flex gap-2 mb-6 flex-wrap">
      {SUB_TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`text-sm px-4 py-2 rounded-full border transition-colors ${
            active === tab.href
              ? "border-gold text-goldlight bg-gold/10"
              : "border-border text-muted hover:text-fg"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
