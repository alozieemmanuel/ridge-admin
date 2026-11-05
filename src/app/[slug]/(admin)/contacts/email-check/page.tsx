"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { useEventPath } from "@/lib/useEvent";
import { PageHeader, ghostButton, inputClass, primaryButton } from "@/components/ui";

interface Item {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  message: string;
  suggestion: string | null;
}

export default function EmailCheckPage() {
  const ep = useEventPath();
  const [items, setItems] = useState<Item[]>([]);
  const [checked, setChecked] = useState(0);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [bulk, setBulk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/registrations/email-check", { cache: "no-store" });
      if (res.ok) {
        const data: { checked: number; items: Item[] } = await res.json();
        setItems(data.items);
        setChecked(data.checked);
        setEdits(Object.fromEntries(data.items.map((i) => [i.id, i.suggestion ?? i.email])));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(item: Item): Promise<boolean> {
    const email = (edits[item.id] ?? "").trim().toLowerCase();
    setBusy((b) => ({ ...b, [item.id]: true }));
    setErrors((e) => ({ ...e, [item.id]: "" }));
    try {
      const res = await fetch(`/api/admin/registrations/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors((e) => ({ ...e, [item.id]: json.error || "Could not save." }));
        return false;
      }
      setItems((list) => list.filter((i) => i.id !== item.id));
      return true;
    } catch {
      setErrors((e) => ({ ...e, [item.id]: "Could not save. Check your connection." }));
      return false;
    } finally {
      setBusy((b) => ({ ...b, [item.id]: false }));
    }
  }

  const fixable = items.filter((i) => i.suggestion);
  async function fixAll() {
    if (!window.confirm(`Replace ${fixable.length} addresses with the suggested corrections? You can still edit any of them afterwards from the contact.`)) return;
    setBulk(true);
    const queue = [...fixable];
    const worker = async () => {
      for (let i = queue.shift(); i; i = queue.shift()) await save({ ...i });
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    setBulk(false);
    load();
  }

  return (
    <AdminShell>
      <PageHeader
        title="Check emails"
        subtitle={loading ? "Checking every address…" : `${checked.toLocaleString()} addresses checked. ${items.length ? `${items.length.toLocaleString()} need attention.` : "All of them look fine."} Fix these before sending a campaign so Mailchimp does not refuse them.`}
        actions={
          <>
            <Link href={ep("/contacts")} className={ghostButton}>
              Back to contacts
            </Link>
            <button onClick={load} className={ghostButton} disabled={loading || bulk}>
              Check again
            </button>
            {fixable.length > 0 && (
              <button onClick={fixAll} className={primaryButton} disabled={bulk}>
                {bulk ? "Fixing…" : `Apply ${fixable.length} suggested fixes`}
              </button>
            )}
          </>
        }
      />

      <div className="border border-border rounded-xl overflow-hidden bg-cardbg">
        <div className="table-scroll overflow-auto max-h-[72vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                {["Name", "Email now", "What is wrong", "Correct it to", ""].map((h) => (
                  <th key={h} className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-muted">
                    No wrong-looking email addresses. If Mailchimp still refuses guests, the cause is not the address itself.
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((i) => (
                  <tr key={i.id} className="border-b border-border/50 last:border-b-0 align-top">
                    <td className="px-5 py-3.5 font-medium whitespace-nowrap">
                      <Link href={ep(`/contacts/${i.id}`)} className="hover:underline">
                        {i.fullName}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-muted break-all">{i.email || <span className="italic opacity-60">No email</span>}</td>
                    <td className="px-5 py-3.5 text-amber-300">{i.message}</td>
                    <td className="px-5 py-3.5 min-w-[260px]">
                      <input
                        value={edits[i.id] ?? ""}
                        onChange={(e) => setEdits((m) => ({ ...m, [i.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && save(i)}
                        className={inputClass}
                        aria-label={`Corrected email for ${i.fullName}`}
                      />
                      {errors[i.id] && <p className="text-red-400 text-xs mt-1.5">{errors[i.id]}</p>}
                    </td>
                    <td className="px-5 py-3.5">
                      <button onClick={() => save(i)} disabled={busy[i.id] || bulk} className={ghostButton}>
                        {busy[i.id] ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
