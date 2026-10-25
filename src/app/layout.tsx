import type { Metadata } from "next";
import "./globals.css";
import { BRAND_NAME, ICON_URL } from "@/lib/brand";
import ClientBoot from "@/components/ClientBoot";

export const metadata: Metadata = {
  title: `${BRAND_NAME} Events`,
  description: "Manage your events: contacts, invitations, tickets, check-in and campaigns.",
  icons: { icon: ICON_URL, shortcut: ICON_URL, apple: ICON_URL },
};

const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('hangout-theme');if(p!=='dark'&&p!=='system')p='light';var t=p==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        {/* Sets the theme before first paint so there is no flash of the wrong colors. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className="min-h-screen bg-pagebg text-fg font-sans antialiased"
        suppressHydrationWarning
      >
        <ClientBoot />
        {children}
      </body>
    </html>
  );
}
