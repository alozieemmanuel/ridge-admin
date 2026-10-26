"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { cacheClear, cacheGet, fetchAndCache } from "@/lib/clientCache";
import { useEvent, useEventSlug, useTerms } from "@/lib/useEvent";
import { themeStyle } from "@/lib/eventTheme";

interface AdminSession {
  name: string;
  email: string;
  role: "OWNER" | "ADMIN";
}

type IconName = "overview" | "people" | "ticket" | "chat" | "mail" | "settings" | "log" | "team";

interface NavItem {
  /** Path after the event address ("" is the Overview). */
  path: string;
  label: string;
  icon: IconName;
  ownerOnly?: boolean;
  /** Shown only when this part is switched on for the event. */
  module?: string;
}

const EVENT_NAV: NavItem[] = [
  { path: "", label: "Overview", icon: "overview" },
  { path: "/contacts", label: "Contacts", icon: "people" },
  { path: "/attendance", label: "Attendance", icon: "ticket", module: "attendance" },
  { path: "/campaigns", label: "Campaigns", icon: "mail", module: "campaigns" },
  { path: "/whatsapp", label: "WhatsApp", icon: "chat", module: "whatsapp" },
  { path: "/settings", label: "Settings", icon: "settings" },
  { path: "/activity", label: "Activity log", icon: "log", ownerOnly: true },
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
    case "chat":
      return (
        <svg {...common}>
          <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.7-5.3A8.4 8.4 0 1 1 21 11.5z" />
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

/**
 * True inside the sidebar frame. The event frame lives in app/[slug]/(admin)/layout.tsx so it stays on screen (and keeps its logo and signed-in admin)
 * while the admin moves between modules; pages that still wrap themselves in <AdminShell> then simply render their content.
 */
const InsideFrame = createContext(false);

export default function AdminShell({ children }: { active?: string; children: React.ReactNode }) {
  const inside = useContext(InsideFrame);
  return inside ? <>{children}</> : <ShellFrame>{children}</ShellFrame>;
}

/** The sidebar frame: the event's menu inside an event, the event list and Team outside one. */
export function ShellFrame({ children }: { active?: string; children: React.ReactNode }) {
  const slug = useEventSlug();
  const pathname = usePathname() || "/";
  const { event, isOwner: eventOwner, has } = useEvent();
  const { people } = useTerms();
  const theme = slug ? themeStyle(event?.color) : undefined;
  const logoNode = slug && event?.logoUrl ? <Logo className="h-9 w-auto" src={event.logoUrl} darkSrc={event.logoDarkUrl} name={event.brandName || event.name} /> : slug && !event ? <span className="block h-9" /> : <Logo className="h-9 w-auto" showFallbackText />;
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
    router.push("/login");
    router.refresh();
  }

  const owner = session?.role === "OWNER" || eventOwner;
  const base = `/${slug}`;
  const items: { href: string; label: string; icon: IconName; current: boolean }[] = slug
    ? EVENT_NAV.filter((i) => (!i.ownerOnly || owner) && (!i.module || !event || has(i.module))).map((i) => {
        const href = `${base}${i.path}`;
        return { href, label: i.path === "/contacts" ? people : i.label, icon: i.icon, current: i.path === "" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`) };
      })
    : [
        { href: "/", label: "All events", icon: "overview", current: pathname === "/" || pathname.startsWith("/new") },
        ...(owner ? [{ href: "/team", label: "Team", icon: "team" as IconName, current: pathname.startsWith("/team") }] : []),
      ];

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-7 pb-6">
        {logoNode}
        {slug ? (
          <div className="mt-4">
            <Link href="/" onClick={() => setMenuOpen(false)} className="text-xs text-muted hover:text-fg">
              ← All events
            </Link>
            <p className="font-serif text-lg leading-tight mt-1.5 break-words">{event?.name ?? "\u00a0"}</p>
          </div>
        ) : (
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted mt-3">Events</p>
        )}
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto" aria-label="Main">
        {items.map((item) => {
          const isCurrent = item.current;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              aria-current={isCurrent ? "page" : undefined}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm border-l-2 transition-colors ${
                isCurrent
                  ? "border-gold bg-gold/15 text-fg font-medium"
                  : "border-transparent text-muted hover:text-fg hover:bg-gold/10"
              }`}
            >
              <span className={isCurrent ? "text-goldlight" : ""}>
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
    <div className={`min-h-screen lg:flex${theme ? " event-themed" : ""}`} style={theme}>
      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-border bg-tint sticky top-0 h-screen no-print">{sidebar}</aside>

      {/* Mobile top bar + drawer */}
      <div className="lg:hidden sticky top-0 z-40 flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-pagebg/95 backdrop-blur no-print">
        <div className="[&_img]:h-7 [&_img]:w-auto">{logoNode}</div>
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
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8">
          <InsideFrame.Provider value={true}>{children}</InsideFrame.Provider>
        </div>
      </main>
    </div>
  );
}
