"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface AdminSession {
  name: string;
  email: string;
  role: "OWNER" | "ADMIN";
}

const TABS: { href: string; label: string }[] = [
  { href: "/admin", label: "Registrations" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/brochure-requests", label: "Brochure Requests" },
  { href: "/admin/seats", label: "Day 7 Seating" },
  { href: "/admin/templates", label: "Emails & WhatsApp" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/admins", label: "Manage Admins" },
];

export default function AdminShell({
  active,
  children,
}: {
  active: string;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/admin/me")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setSession(data.admin))
      .catch(() => setSession(null));
  }, []);

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-serif text-3xl">
              RIDGE<span className="text-gold">.</span> Admin
            </h1>
            {session && (
              <p className="text-muted text-sm mt-1">
                Signed in as {session.name} ({session.role.toLowerCase()})
              </p>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="text-sm px-4 py-2 rounded-full border border-border hover:border-gold transition-colors"
          >
            Log out
          </button>
        </div>
        <nav className="max-w-6xl mx-auto px-6 flex gap-2 pb-4 flex-wrap">
          {TABS.map((tab) => (
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
        </nav>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
