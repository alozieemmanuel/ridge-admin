"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { useIsTechnical } from "@/lib/useIsOwner";
import { ghostButton, inputClass, primaryButton } from "@/components/ui";
import type { SenderRow } from "@/components/SenderStrip";

interface Available {
  kind: string;
  name: string;
  needs: string[];
  suggestedLimit: number;
  note: string;
}
interface Item {
  kind: string;
  dailyLimit: number;
  enabled: boolean;
}

/** The email sender pool: which services send mail, in what order, and each one's daily limit. */
export default function SendersPage() {
  const [available, setAvailable] = useState<Available[]>([]);
  const [rows, setRows] = useState<SenderRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const tech = useIsTechnical();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function load() {
    const res = await fetch("/api/admin/senders").catch(() => null);
    if (!res?.ok) return setLoaded(true);
    const json = await res.json();
    setAvailable(json.available);
    setRows(json.senders);
    setItems(json.senders.map((s: SenderRow) => ({ kind: s.kind, dailyLimit: s.dailyLimit, enabled: s.enabled })));
    setIsOwner(json.isOwner);
    setLoaded(true);
  }
  useEffect(() => {
    load();
  }, []);

  const def = (kind: string) => available.find((a) => a.kind === kind);
  const state = (kind: string) => rows.find((r) => r.kind === kind);
  const unused = available.filter((a) => !items.some((i) => i.kind === a.kind));

  const move = (i: number, by: number) =>
    setItems((list) => {
      const next = [...list];
      const j = i + by;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const patch = (i: number, p: Partial<Item>) => setItems((list) => list.map((x, k) => (k === i ? { ...x, ...p } : x)));

  async function save() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/senders", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senders: items }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setMessage({ text: json.error || "Could not save.", ok: false });
    setMessage({ text: "Saved.", ok: true });
    load();
  }

  return (
    <AdminShell>
      <div className="mb-7">
        <Link href="/" className="text-sm text-muted hover:text-fg">
          ← All events
        </Link>
        <h1 className="font-serif text-4xl mt-3">Email senders</h1>
        <p className="text-muted text-sm mt-2 max-w-2xl">
          List the services that send your email, best first. Each email goes through the first one that has room today. If it reaches its limit or fails, the next one takes over.
          If every limit is used, campaign emails wait and go out after the count resets at midnight. This list is shared: it applies to every event, now and any you create later.
        </p>
      </div>

      {!loaded ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="max-w-3xl">
          {items.length === 0 && (
            <div className="rounded-xl border border-border p-5 mb-6 text-sm">
              <p className="mb-3">No senders are listed, so the old rule applies: campaigns go through Brevo and everything else through Gmail.</p>
              {isOwner && (
                <button
                  className={ghostButton}
                  onClick={() => setItems(available.slice(0, 2).map((a) => ({ kind: a.kind, dailyLimit: a.suggestedLimit, enabled: true })))}
                >
                  Start with Gmail, then Brevo
                </button>
              )}
            </div>
          )}

          <ol className="space-y-3 mb-6">
            {items.map((it, i) => {
              const d = def(it.kind);
              const st = state(it.kind);
              const configured = st ? st.configured : false;
              return (
                <li key={it.kind} className="rounded-xl border border-border p-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="h-7 w-7 rounded-full border border-gold grid place-items-center text-xs shrink-0">{i + 1}</span>
                    <div className="min-w-0 grow">
                      <p className="font-medium text-sm">{d?.name ?? it.kind}</p>
                      <p className="text-xs text-muted">{d?.note}</p>
                    </div>
                    {isOwner && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="px-2.5 py-1.5 rounded-lg border border-border disabled:opacity-30">
                          ↑
                        </button>
                        <button onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down" className="px-2.5 py-1.5 rounded-lg border border-border disabled:opacity-30">
                          ↓
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid sm:grid-cols-[10rem_1fr] gap-4 items-end">
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-muted mb-1.5" htmlFor={`lim-${it.kind}`}>
                        Daily limit
                      </label>
                      <input
                        id={`lim-${it.kind}`}
                        inputMode="numeric"
                        disabled={!isOwner}
                        value={it.dailyLimit === 0 ? "" : String(it.dailyLimit)}
                        placeholder="No limit"
                        onChange={(e) => patch(i, { dailyLimit: parseInt(e.target.value.replace(/\D/g, "") || "0", 10) })}
                        className={inputClass}
                      />
                    </div>
                    <div className="flex items-center gap-4 flex-wrap text-sm">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" className="accent-gold" disabled={!isOwner} checked={it.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} />
                        Switched on
                      </label>
                      {st && <span className="text-xs text-muted">{st.used} sent today</span>}
                      {isOwner && (
                        <button className="text-xs text-red-400 hover:underline" onClick={() => setItems((list) => list.filter((x) => x.kind !== it.kind))}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  {!configured && (
                    <p className="text-xs text-amber-400 mt-3">
                      {tech ? `Not set up on the server yet. Add ${d?.needs.join(" and ")} to the environment settings, then redeploy.` : "Not set up yet. The owner needs to connect it."}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>

          {isOwner && unused.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-8">
              <span className="text-sm text-muted">Add a sender:</span>
              {unused.map((a) => (
                <button key={a.kind} className={ghostButton} onClick={() => setItems((list) => [...list, { kind: a.kind, dailyLimit: a.suggestedLimit, enabled: true }])}>
                  {a.name}
                </button>
              ))}
            </div>
          )}

          {isOwner ? (
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={save} disabled={busy} className={primaryButton}>
                {busy ? "Saving…" : "Save senders"}
              </button>
              {message && <span className={`text-sm ${message.ok ? "text-muted" : "text-red-400"}`}>{message.text}</span>}
            </div>
          ) : (
            <p className="text-sm text-muted">Only an owner can change this list.</p>
          )}

          <div className="mt-10 rounded-xl border border-border p-5 text-sm text-muted space-y-2">
            <p className="font-medium text-fg">Good to know</p>
            {tech && <p>Keys never go in this page. They stay in the server environment: GMAIL_USER and GMAIL_APP_PASSWORD, BREVO_API_KEY and EMAIL_FROM, MAILERSEND_API_KEY and MAILERSEND_FROM.</p>}
            <p>Tickets with the QR image only go through Gmail, because the other services do not carry that image.</p>
            <p>Tickets and confirmations never wait. They ignore the daily limits and use the first sender that works.</p>
            <p>Open and delivery tracking exists for Brevo only. Mail sent through Gmail or MailerSend shows as Sent.</p>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
