"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { ghostButton } from "@/components/ui";

export interface SenderRow {
  kind: string;
  name: string;
  label: string;
  position: number;
  enabled: boolean;
  configured: boolean;
  needs: string[];
  dailyLimit: number;
  used: number;
  remaining: number | null;
  state: "ready" | "full" | "off" | "not_configured";
}

const STATE_TEXT: Record<SenderRow["state"], string> = {
  ready: "Ready",
  full: "Limit reached",
  off: "Switched off",
  not_configured: "Not set up",
};

/** What each email sender has sent today, shown on the Campaigns page. */
export default function SenderStrip({ onChange }: { onChange?: () => void }) {
  const [data, setData] = useState<{ senders: SenderRow[]; waiting: number; resetsAt: string; isOwner: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/senders").catch(() => null);
    if (res?.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(() => load(), 30_000);

  async function flush() {
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/admin/senders/flush", { method: "POST" }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    setNote(res?.ok ? `Sent ${json.sent}${json.failed ? `, ${json.failed} failed` : ""}. ${json.waiting} still waiting.` : json.error || "Could not send.");
    load();
    onChange?.();
  }

  if (!data) return null;
  const resets = new Date(data.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="border border-border rounded-xl p-5 mb-8">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h3 className="font-medium text-sm">Email senders</h3>
          <p className="text-xs text-muted mt-1">
            {data.senders.length === 0
              ? "No sender list yet. Campaigns go through Brevo and everything else through Gmail."
              : `Each email goes through the first sender with room left. The count resets at ${resets}.`}
          </p>
        </div>
        <Link href="/senders" className={ghostButton}>
          {data.isOwner ? "Manage senders" : "View senders"}
        </Link>
      </div>

      {data.senders.length > 0 && (
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.senders.map((s, i) => {
            const pct = s.dailyLimit > 0 ? Math.min(100, Math.round((s.used / s.dailyLimit) * 100)) : 0;
            return (
              <li key={s.kind} className="rounded-lg border border-border p-3.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium truncate">
                    {i + 1}. {s.label}
                  </span>
                  <span className={`text-xs whitespace-nowrap ${s.state === "ready" ? "text-emerald-400" : s.state === "full" ? "text-amber-400" : "text-muted"}`}>{STATE_TEXT[s.state]}</span>
                </div>
                <p className="text-xs text-muted mt-1.5">
                  {s.used} sent today{s.dailyLimit > 0 ? ` of ${s.dailyLimit}` : ", no limit"}
                </p>
                {s.dailyLimit > 0 && (
                  <div className="h-1.5 rounded-full bg-border mt-2 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className={`h-full ${pct >= 100 ? "bg-amber-400" : "bg-gold"}`} style={{ width: `${pct}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {data.waiting > 0 && (
        <div className="mt-4 flex items-center gap-3 flex-wrap text-sm">
          <span className="text-amber-400">
            {data.waiting} email{data.waiting === 1 ? "" : "s"} waiting for the next day&apos;s allowance.
          </span>
          <button onClick={flush} disabled={busy} className={ghostButton}>
            {busy ? "Sending…" : "Send waiting emails now"}
          </button>
          {note && <span className="text-xs text-muted">{note}</span>}
        </div>
      )}
    </div>
  );
}
