"use client";

/** Uploads one logo file for an event. `slug` is passed explicitly because the wizard runs outside the event's address. */
export async function uploadLogo(slug: string, variant: "light" | "dark", file: File): Promise<string | null> {
  const body = new FormData();
  body.append("file", file);
  body.append("variant", variant);
  const res = await fetch("/api/admin/event/logo", { method: "POST", headers: { "x-event": slug }, body }).catch(() => null);
  if (res && res.ok) return null;
  const json = res ? await res.json().catch(() => ({})) : {};
  return json.error || "The logo could not be uploaded.";
}

export async function removeLogo(slug: string, variant: "light" | "dark"): Promise<void> {
  await fetch(`/api/admin/event/logo?variant=${variant}`, { method: "DELETE", headers: { "x-event": slug } }).catch(() => null);
}
