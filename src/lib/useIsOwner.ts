"use client";

import { useEffect, useState } from "react";
import { cacheGet, fetchAndCache } from "@/lib/clientCache";

interface Me {
  admin?: { role?: string } | null;
}

/** True when the signed-in admin has the OWNER role (used to show delete controls). */
export function useIsOwner(): boolean {
  const [isOwner, setIsOwner] = useState(() => cacheGet<Me>("/api/admin/me")?.admin?.role === "OWNER");

  useEffect(() => {
    fetchAndCache<Me>("/api/admin/me").then((data) => setIsOwner(data?.admin?.role === "OWNER"));
  }, []);

  return isOwner;
}
