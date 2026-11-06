"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { useEventPath } from "@/lib/useEvent";
import { PageHeader, Pill, ghostButton } from "@/components/ui";

interface Item {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  status: string;
}

const STATUS_TEXT: Record<string, { label: string; tone: string }> = {
  unsubscribed: { label: "Unsubscribed", tone: "text-amber-300" },
  cleaned: { label: "Cleaned (address bounced)", tone: "text-red-400" },
  archived: { label: "Archived", tone: "text-muted" },
};

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function UnsubscribedPage() {
  const ep = useEventPath();
  const [items, setItems] = useState<Item[]>([]);
  const [checked, setChecked] = useState(0);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setWarning("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 65_000);
    try {
      const res = await fetch("/api/admin/campaigns/mailchimp/unsubscribed", { cache: "no-store", signal: controller.signal });
      const text = await res.text();
      let data: { error?: string; warning?: string; configured?: boolean; items?: Item[]; checked?: number } = {};
      try {
        data = JSON.parse(text);
      } catch {
        // The server answered with something that is not JSON (for example a timeout page).
      }
      if (!res.ok || data.error) {
        setItems([]);
        setError(data.error || (res.status === 504 || res.status === 408 ? "The server gave up waiting for Mailchimp (timeout). Press Refresh to try again." : `The server could not read the list (error ${res.status}). Press Refresh to try again.`));
        return;
      }
      setConfigured(data.configured !== false);
      setItems(data.items || []);
      setChecked(data.checked || 0);
      setWarning(data.warning || "");
    } catch (err) {
      setItems([]);
      setError(err instanceof DOMException && err.name === "AbortError" ? "Mailchimp took too long to answer. Press Refresh to try again." : "Could not reach the server. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function download() {
    const lines = [["Name", "Email", "Phone", "Status in Mailchimp"], ...items.map((i) => [i.fullName, i.email, i.phone, STATUS_TEXT[i.status]?.label ?? i.status])].map((r) => r.map(csvCell).join(","));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `unsubscribed-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AdminShell>
      <PageHeader
        title="Unsubscribed in Mailchimp"
        subtitle={
          loading
            ? "Asking Mailchimp who has unsubscribed…"
            : error
              ? "Could not read the list."
              : !configured
              ? "Mailchimp is not set up on the server."
              : `${items.length.toLocaleString()} of ${checked.toLocaleString()} guests will not be emailed by Mailchimp. Campaigns skip them on their own, and they are never added back. Only the guest can re-subscribe, from a link in a Mailchimp email.`
        }
        actions={
          <>
            <Link href={ep("/campaigns")} className={ghostButton}>
              Back to campaigns
            </Link>
            <button onClick={load} className={ghostButton} disabled={loading}>
              Refresh
            </button>
            {items.length > 0 && (
              <button onClick={download} className={ghostButton}>
                Download CSV
              </button>
            )}
          </>
        }
      />

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {warning && <p className="text-amber-300 text-sm mb-4">{warning}</p>}

      <div className="border border-border rounded-xl overflow-hidden bg-cardbg">
        <div className="table-scroll overflow-auto max-h-[72vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                {["Name", "Email", "Phone", "Status in Mailchimp"].map((h) => (
                  <th key={h} className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && !error && items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-muted">
                    Nobody on this guest list has unsubscribed in Mailchimp.
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((i) => {
                  const st = STATUS_TEXT[i.status] ?? { label: i.status, tone: "text-muted" };
                  return (
                    <tr key={i.id} className="border-b border-border/50 last:border-b-0">
                      <td className="px-5 py-3.5 font-medium whitespace-nowrap">
                        <Link href={ep(`/contacts/${i.id}`)} className="hover:underline">
                          {i.fullName}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-muted break-all">{i.email}</td>
                      <td className="px-5 py-3.5 text-muted whitespace-nowrap">{i.phone || "-"}</td>
                      <td className="px-5 py-3.5">
                        <Pill tone={st.tone}>{st.label}</Pill>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
