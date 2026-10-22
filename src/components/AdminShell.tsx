"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { cacheClear, cacheGet, fetchAndCache } from "@/lib/clientCache";

interface AdminSession {
  name: string;
  email: string;
  role: "OWNER" | "ADMIN";
}

type IconName = "template" | "overview" | "people" | "ticket" | "mail" | "settings" | "log" | "team";

const NAV: { href: string; label: string; icon: IconName; ownerOnly?: boolean }[] = [
  { href: "/admin", label: "Overview", icon: "overview" },
  { href: "/admin/registrations", label: "Registrations", icon: "people" },
  { href: "/admin/attendance", label: "Attendance", icon: "ticket" },
  { href: "/admin/campaigns", label: "Campaigns", icon: "mail" },
  { href: "/admin/templates", label: "Email templates", icon: "template" },
  { href: "/admin/settings", label: "Settings", icon: "settings" },
  { href: "/admin/audit", label: "Activity log", icon: "log", ownerOnly: true },
  { href: "/admin/admins", label: "Team", icon: "team" },
];

function Icon({ name }: { name: IconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case "people":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
          <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.4c1.9.8 3 2.7 3 5.6" />
        </svg>
      );
    case "ticket":
      return (
        <svg {...common}>
          <path d="M3 9a2 2 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a2 2 0 0 1 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" />
          <path d="M14 5v14" strokeDasharray="2 2.5" />
        </svg>
      );
    case "mail":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3.5 7 8.5 6 8.5-6" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case "template":
      return (
        <svg {...common}>
          <path d="M4 4h16v12H8l-4 4z" />
          <path d="M8 9h8M8 12h5" />
        </svg>
      );
    case "log":
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5M9 13h6M9 17h6" />
        </svg>
      );
    case "team":
      return (
        <svg {...common}>
          <path d="M12 3 4 6v6c0 4.4 3.2 7.6 8 9 4.8-1.4 8-4.6 8-9V6z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
  }
}

export default function AdminShell({
  active,
  children,
}: {
  active: string;
  children: React.ReactNode;
}) {
  // The signed-in admin is remembered between modules, so the sidebar doesn't flash empty on every switch.
  const [session, setSession] = useState<AdminSession | null>(
    () => cacheGet<{ admin: AdminSession }>("/api/admin/me")?.admin ?? null
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchAndCache<{ admin: AdminSession }>("/api/admin/me").then((data) => setSession(data?.admin ?? null));
  }, []);

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    cacheClear();
    router.push("/admin/login");
    router.refresh();
  }

  const items = NAV.filter((item) => !item.ownerOnly || session?.role === "OWNER");

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-7 pb-6">
        <Logo className="h-9 w-auto" showFallbackText />
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted mt-3">Admin</p>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto" aria-label="Main">
        {items.map((item) => {
          const isActive = active === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm border-l-2 transition-colors ${
                isActive
                  ? "border-gold bg-gold/15 text-fg font-medium"
                  : "border-transparent text-muted hover:text-fg hover:bg-gold/10"
              }`}
            >
              <span className={isActive ? "text-goldlight" : ""}>
                <Icon name={item.icon} />
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-6 py-5 border-t border-border">
        {session && (
          <div className="mb-3 min-w-0">
            <p className="text-sm font-medium truncate">{session.name}</p>
            <p className="text-xs text-muted capitalize">{session.role.toLowerCase()}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full text-sm px-4 py-2.5 rounded-lg border border-border hover:border-gold transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-border bg-tint sticky top-0 h-screen no-print">{sidebar}</aside>

      {/* Mobile top bar + drawer */}
      <div className="lg:hidden sticky top-0 z-40 flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-pagebg/95 backdrop-blur no-print">
        <Logo className="h-7 w-auto" showFallbackText />
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          className="px-3 py-2 rounded-lg border border-border text-sm"
        >
          Menu
        </button>
      </div>
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex no-print">
          <div className="w-72 max-w-[85%] bg-tint border-r border-border h-full">{sidebar}</div>
          <button className="flex-1 bg-black/40" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      <main className="flex-1 min-w-0">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
