"use client";

import { useCallback, useEffect, useState } from "react";
import TemplatePicker, { type TemplateInfo } from "@/components/TemplatePicker";
import { useAutoRefresh } from "@/lib/useAutoRefresh";

interface Broadcast {
  id: string;
  audience: string;
  templateName: string;
  previewText: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  sentAt: string;
  sentByName: string | null;
  delivered: number;
  read: number;
}

const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Registrants", keys: ["ALL", "EARLY_BIRD", "LATE", "NOT_PAID", "PARTIAL", "PAID", "CHECKED_IN", "NOT_CHECKED_IN"] },
  { title: "Prospects", keys: ["PROSPECTS_ALL", "PROSPECTS_NOT_REGISTERED", "PROSPECTS_FOLLOW_UP"] },
];

const goldButton =
  "text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest disabled:opacity-50";

export default function WhatsAppBroadcastPanel() {
  const [audience, setAudience] = useState("ALL");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [pick, setPick] = useState<{ template: TemplateInfo | null; params: string[]; ready: boolean }>({ template: null, params: [], ready: false });
  const [step, setStep] = useState<"compose" | "confirm">("compose");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/whatsapp/broadcasts");
      if (!res.ok) return;
      const data = await res.json();
      setLabels(data.labels);
      setCounts(data.counts);
      setBroadcasts(data.broadcasts);
    } catch {
      // keep last data
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(() => load(), 15_000);

  const recipientCount = counts[audience] ?? 0;
  const canSend = pick.ready && recipientCount > 0;

  async function send() {
    if (!pick.template) return;
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/whatsapp/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, templateName: pick.template.name, language: pick.template.language, params: pick.params }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const b = data.broadcast;
        setMessage({ text: `Sent to ${b.sentCount} of ${b.recipientCount}${b.failedCount ? ` (${b.failedCount} failed)` : ""}.`, ok: true });
        setStep("compose");
        load();
      } else {
        setMessage({ text: data.error || "Failed to send.", ok: false });
      }
    } catch {
      setMessage({ text: "Couldn't reach the server. Check your connection and try again.", ok: false });
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="border border-border rounded-xl p-6 mb-8">
        <p className="text-sm text-muted mb-5">
          WhatsApp only lets a business start a chat with an approved template, so broadcasts use one. Replies from
          people appear in the WhatsApp tab.
        </p>

        {GROUPS.map((g) => (
          <div key={g.title} className="mb-4">
            <label className="block text-xs uppercase tracking-wider text-muted mb-2">Send to: {g.title}</label>
            <div className="flex gap-2 flex-wrap">
              {g.keys.map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setAudience(k);
                    setStep("compose");
                  }}
                  className={`text-sm px-4 py-2 rounded-full border transition-colors whitespace-nowrap ${
                    audience === k ? "border-gold text-goldlight bg-gold/10" : "border-border text-muted"
                  }`}
                >
                  {labels[k] ?? k}
                  {counts[k] !== undefined && <span className="ml-1.5 opacity-70">{counts[k]}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted mb-6">Counts include only people with a usable phone number.</p>

        <div className="mb-5">
          <TemplatePicker personalize onChange={setPick} />
        </div>

        {message && <p className={`text-sm mb-4 ${message.ok ? "text-goldlight" : "text-red-400"}`}>{message.text}</p>}

        {step === "compose" && (
          <button onClick={() => setStep("confirm")} disabled={!canSend} className={goldButton}>
            Continue
          </button>
        )}
        {step === "confirm" && (
          <div className="border border-gold/30 rounded-xl p-4">
            <p className="text-sm mb-4">
              This will send &quot;{pick.template?.name}&quot; on WhatsApp to <span className="text-goldlight">{recipientCount}</span>{" "}
              people ({(labels[audience] ?? audience).toLowerCase()}). Continue?
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setStep("compose")}
                disabled={sending}
                className="text-sm px-4 py-2.5 rounded-full border border-border text-muted hover:text-fg disabled:opacity-60"
              >
                Back
              </button>
              <button onClick={send} disabled={sending} className={goldButton}>
                {sending ? "Sending…" : `Send to ${recipientCount}`}
              </button>
            </div>
          </div>
        )}
      </div>

      <h3 className="font-serif text-xl mb-4">WhatsApp broadcasts</h3>
      {broadcasts.length === 0 ? (
        <p className="text-muted text-sm">No WhatsApp broadcasts sent yet.</p>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="table-scroll overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Template</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Audience</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Sent</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Delivered</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Read</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Date</th>
                </tr>
              </thead>
              <tbody>
                {broadcasts.map((b) => (
                  <tr key={b.id} className="border-b border-border/50 last:border-b-0" title={b.previewText}>
                    <td className="px-5 py-4 whitespace-nowrap font-medium">{b.templateName}</td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">{labels[b.audience] ?? b.audience}</td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">
                      {b.sentCount} of {b.recipientCount}
                      {b.failedCount > 0 && <span className="text-red-400"> ({b.failedCount} failed)</span>}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap text-emerald-400">{b.delivered}</td>
                    <td className="px-5 py-4 whitespace-nowrap text-emerald-400">{b.read}</td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">{new Date(b.sentAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
