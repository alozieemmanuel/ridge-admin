"use client";

import { usePathname } from "next/navigation";
import { ShellFrame } from "@/components/AdminShell";

/**
 * The sidebar frame is built once here, so moving between modules only swaps the content on the right:
 * the logo, the menu and the signed-in admin are not reloaded each time. The sign-in page has no sidebar.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/admin";
  if (pathname.startsWith("/admin/login")) return <>{children}</>;
  return <ShellFrame active={pathname}>{children}</ShellFrame>;
}
