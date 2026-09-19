import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RIDGE Admin",
  description: "RIDGE registrations and brochure requests admin dashboard.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className="min-h-screen bg-pagebg text-fg font-sans antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
