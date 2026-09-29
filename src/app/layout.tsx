import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RIDGE Admin",
  description: "RIDGE registrations and brochure requests admin dashboard.",
};

const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('ridge-theme');if(p!=='light'&&p!=='system')p='dark';var t=p==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Sets the theme before first paint so there is no flash of the wrong colors. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className="min-h-screen bg-pagebg text-fg font-sans antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}