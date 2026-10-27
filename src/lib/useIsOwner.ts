"use client";

import { useEffect, useState } from "react";
import { cacheGet, fetchAndCache } from "@/lib/clientCache";
import { isPower, isTechnical } from "@/lib/roles";

interface Me {
  admin?: { role?: string } | null;
}

function useRole(): string {
  const [role, setRole] = useState(() => cacheGet<Me>("/api/admin/me")?.admin?.role ?? "");

  useEffect(() => {
    fetchAndCache<Me>("/api/admin/me").then((data) => setRole(data?.admin?.role ?? ""));
  }, []);

  return role;
}

/** True for an owner or a super admin (used to show delete and management controls). */
export function useIsOwner(): boolean {
  return isPower(useRole());
}

/** True only for the owner: keys, private addresses, setup code and other technical details are shown to nobody else. */
export function useIsTechnical(): boolean {
  return isTechnical(useRole());
}
