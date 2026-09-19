"use client";

import { useEffect, useState } from "react";

/** True when the signed-in admin has the OWNER role (used to show delete controls). */
export function useIsOwner(): boolean {
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setIsOwner(data.admin?.role === "OWNER"))
      .catch(() => setIsOwner(false));
  }, []);

  return isOwner;
}
