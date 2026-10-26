"use client";

import { useState } from "react";
import { cacheDeletePrefix } from "@/lib/clientCache";
import { ghostButton, inputClass, primaryButton } from "@/components/ui";

/** Adds one person by hand. Someone with the same email is updated instead of duplicated. */
export default function AddContactDialog({ onClose, onAdded, person }: { onClose: () => void; onAdded: () => void; person: string }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent, another: boolean) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/registrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName, email, phone }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(json.error || "Could not add them. Check your connection and try again.");
    cacheDeletePrefix("/api/admin/registrations?");
    cacheDeletePrefix("/api/admin/overview");
    onAdded();
    if (another) {
      setDone(json.result === "added" ? `${fullName.trim() || email} was added.` : "They were already on the list, so their details were updated.");
      setFullName("");
      setEmail("");
      setPhone("");
    } else onClose();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-labelledby="add-title">
      <form onSubmit={(e) => submit(e, false)} className="w-full max-w-md bg-cardbg border border-border rounded-2xl p-6">
        <p className="text-xs uppercase tracking-wider text-muted mb-1">Add by hand</p>
        <h3 id="add-title" className="font-serif text-xl mb-5">
          Add a {person.toLowerCase()}
        </h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="ac-name" className="block text-sm font-medium mb-1.5">
              Full name
            </label>
            <input id="ac-name" autoFocus required value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="ac-email" className="block text-sm font-medium mb-1.5">
              Email
            </label>
            <input id="ac-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="ac-phone" className="block text-sm font-medium mb-1.5">
              Phone (optional)
            </label>
            <input id="ac-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-400 mt-4">
            {error}
          </p>
        )}
        {done && <p className="text-sm text-muted mt-4">{done}</p>}
        <div className="flex items-center justify-end gap-3 mt-6 flex-wrap">
          <button type="button" onClick={onClose} className={ghostButton} disabled={busy}>
            Close
          </button>
          <button type="button" onClick={(e) => submit(e, true)} className={ghostButton} disabled={busy || !fullName.trim() || !email.trim()}>
            Save and add another
          </button>
          <button type="submit" className={primaryButton} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
