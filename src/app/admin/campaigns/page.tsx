"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";

type Audience =
  | "ALL"
  | "EARLY_BIRD"
  | "LATE"
  | "NOT_PAID"
  | "PARTIAL"
  | "PAID"
  | "CHECKED_IN"
  | "NOT_CHECKED_IN";

const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: "ALL", label: "All registrants" },
  { value: "EARLY_BIRD", label: "Early Bird" },
  { value: "LATE", label: "Late" },
  { value: "NOT_PAID", label: "Not paid" },
  { value: "PARTIAL", label: "Partially paid" },
  { value: "PAID", label: "Fully paid" },
  { value: "CHECKED_IN", label: "Checked in (Day 7)" },
  { value: "NOT_CHECKED_IN", label: "Not checked in (Day 7)" },
];

interface Campaign {
  id: string;
  subject: string;
  audience: Audience;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  sentAt: string;
  sentByName: string | null;
}

export default function CampaignsPage() {
  const [audience, setAudience] = useState<Audience>("ALL");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<"compose" | "confirm">("compose");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const [countsRes, campaignsRes] = await Promise.all([
      fetch("/api/admin/campaigns/audience-counts"),
      fetch("/api/admin/campaigns"),
    ]);
    if (countsRes.ok) setCounts((await countsRes.json()).counts);
    if (campaignsRes.ok) setCampaigns((await campaignsRes.json()).campaigns);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const recipientCount = counts[audience] ?? 0;
  const canSend = subject.trim() !== "" && body.trim() !== "" && recipientCount > 0;

  async function handleSend() {
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, subject, body }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          text: `Sent to ${data.campaign.sentCount} of ${data.campaign.recipientCount}${
            data.campaign.failedCount ? ` (${data.campaign.failedCount} failed)` : ""
          }.`,
          ok: true,
        });
        setSubject("");
        setBody("");
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
    <AdminShell active="/admin/campaigns">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">Campaigns</h2>
        <p className="text-muted text-sm mt-1">
          Send a one-off email to a segment of registrants. Confirmation, brochure, seat-invite and
          payment-reminder emails are separate — those still go out automatically or from the ⋯ menu on
          Registrations/Payments.
        </p>
      </div>

      <div className="border border-border rounded-xl p-6 mb-8">
        <label className="block text-xs uppercase tracking-wider text-muted mb-2">Send to</label>
        <div className="flex gap-2 mb-5 flex-wrap">
          {AUDIENCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setAudience(opt.value)}
              className={`text-sm px-4 py-2 rounded-full border transition-colors whitespace-nowrap ${
                audience === opt.value ? "border-gold text-goldlight bg-gold/10" : "border-border text-muted"
              }`}
            >
              {opt.label}
              {counts[opt.value] !== undefined && <span className="ml-1.5 opacity-70">{counts[opt.value]}</span>}
            </button>
          ))}
        </div>

        <label className="block text-xs uppercase tracking-wider text-muted mb-2">Subject</label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. A quick update ahead of Day 7"
          className="w-full bg-black/30 border border-border rounded-lg px-4 py-2.5 text-sm mb-4 focus:outline-none focus:border-gold"
        />

        <label className="block text-xs uppercase tracking-wider text-muted mb-2">Message</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          placeholder="Type the message everyone in this segment will get. A blank line starts a new paragraph."
          className="w-full bg-black/30 border border-border rounded-lg px-4 py-3 text-sm mb-2 focus:outline-none focus:border-gold font-mono"
        />
        <p className="text-xs text-muted mb-5">
          Use {"{{first_name}}"} or {"{{full_name}}"} to personalize.
        </p>

        {message && (
          <p className={`text-sm mb-4 ${message.ok ? "text-goldlight" : "text-red-400"}`}>{message.text}</p>
        )}

        {step === "compose" && (
          <button
            onClick={() => setStep("confirm")}
            disabled={!canSend}
            className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest disabled:opacity-50"
          >
            Continue
          </button>
        )}

        {step === "confirm" && (
          <div className="border border-gold/30 rounded-xl p-4">
            <p className="text-sm mb-4">
              This will send to <span className="text-goldlight">{recipientCount}</span>{" "}
              {AUDIENCE_OPTIONS.find((o) => o.value === audience)?.label.toLowerCase()}. Continue?
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setStep("compose")}
                disabled={sending}
                className="text-sm px-4 py-2.5 rounded-full border border-border text-muted hover:text-fg disabled:opacity-60"
              >
                Back
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest disabled:opacity-60"
              >
                {sending ? "Sending…" : `Send to ${recipientCount}`}
              </button>
            </div>
          </div>
        )}
      </div>

      <h3 className="font-serif text-xl mb-4">Sent campaigns</h3>
      {loading && <p className="text-muted">Loading…</p>}
      {!loading && campaigns.length === 0 && <p className="text-muted text-sm">No campaigns sent yet.</p>}
      {!loading && campaigns.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="table-scroll overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Subject</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Audience</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Sent</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Date</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 last:border-b-0">
                    <td className="px-5 py-4 whitespace-nowrap font-medium">{c.subject}</td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">
                      {AUDIENCE_OPTIONS.find((o) => o.value === c.audience)?.label ?? c.audience}
                    </td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">
                      {c.sentCount} of {c.recipientCount}
                      {c.failedCount > 0 && <span className="text-red-400"> ({c.failedCount} failed)</span>}
                    </td>
                    <td className="px-5 py-4 text-muted whitespace-nowrap">
                      {new Date(c.sentAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
