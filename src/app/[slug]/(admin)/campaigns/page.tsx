"use client";

import { useEffect, useState, useCallback } from "react";
import { useEvent, useEventPath, useTerms } from "@/lib/useEvent";
import AdminShell from "@/components/AdminShell";
import { flushUntilDone } from "@/lib/flushQueue";
import { useIsOwner } from "@/lib/useIsOwner";
import SenderStrip from "@/components/SenderStrip";
import { summarizeBlocked } from "@/lib/sendErrorText";

type Audience = "ALL" | "NOT_INVITED" | "INVITED_NOT_RESERVED" | "RESERVED" | "CHECKED_IN" | "NOT_CHECKED_IN" | "EARLY_BIRD" | "LATE" | "NOT_PAID" | "PARTIAL" | "PAID";

const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: "ALL", label: "Everyone" },
  { value: "NOT_INVITED", label: "Not invited yet" },
  { value: "INVITED_NOT_RESERVED", label: "Invited, not reserved" },
  { value: "RESERVED", label: "Seat reserved" },
  { value: "CHECKED_IN", label: "Checked in" },
  { value: "NOT_CHECKED_IN", label: "Not checked in" },
];

// Campaigns sent before this dashboard was repurposed can carry the older audiences; they still read correctly in the history.
const OLD_AUDIENCE_LABELS: Record<string, string> = {
  EARLY_BIRD: "Early Bird",
  LATE: "Late",
  NOT_PAID: "Not paid",
  PARTIAL: "Partially paid",
  PAID: "Fully paid",
};
const audienceLabel = (a: string) => AUDIENCE_OPTIONS.find((o) => o.value === a)?.label ?? OLD_AUDIENCE_LABELS[a] ?? a;

interface Campaign {
  id: string;
  subject: string;
  audience: Audience;
  sentAt: string;
  sentByName: string | null;
}

interface CampaignDetail extends Campaign {
  body: string;
  ctaLabel?: string | null;
}

/** One campaign: who it went to and the email itself. */
function CampaignDialog({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/campaigns/${campaignId}?pageSize=1`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.ok) setDetail(data.campaign);
        else setError(data.error || "Couldn't load this campaign.");
      })
      .catch(() => alive && setError("Couldn't reach the server."));
    return () => {
      alive = false;
    };
  }, [campaignId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-pagebg border border-border rounded-2xl w-full max-w-2xl my-8 p-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted mb-1">Campaign</p>
            <h3 className="font-serif text-2xl break-words">{detail?.subject ?? (error ? "Campaign" : "Loading…")}</h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg text-2xl leading-none" aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        {detail && (
          <>
            <dl className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-sm mb-6">
              <dt className="text-muted">Sent to</dt>
              <dd>{audienceLabel(detail.audience)}</dd>
              <dt className="text-muted">Date</dt>
              <dd>{new Date(detail.sentAt).toLocaleString()}</dd>
              {detail.sentByName && (
                <>
                  <dt className="text-muted">Sent by</dt>
                  <dd>{detail.sentByName}</dd>
                </>
              )}
            </dl>

            <p className="text-xs uppercase tracking-wider text-muted mb-2">Email</p>
            <div className="border border-border rounded-xl p-5 max-h-[50vh] overflow-y-auto">
              <p className="text-sm font-medium mb-3">{detail.subject}</p>
              <div className="text-sm text-muted whitespace-pre-wrap">{detail.body}</div>
              {detail.ctaLabel && (
                <p className="mt-4">
                  <span className="inline-block text-xs uppercase tracking-widest border border-border rounded-full px-4 py-2">{detail.ctaLabel}</span>
                </p>
              )}
            </div>
            <p className="text-xs text-muted mt-2">
              Shown as written. {"{{first_name}}"} and {"{{full_name}}"} were filled in for each person.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function CampaignsPage() {
  const ep = useEventPath();
  const isOwner = useIsOwner();
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>("ALL");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<"compose" | "confirm">("compose");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const { admin } = useEvent();
  const terms = useTerms();
  const [withButton, setWithButton] = useState(false);
  const [buttonLabel, setButtonLabel] = useState("");
  const ctaLabel = withButton ? (buttonLabel.trim() || terms.action) : undefined;
  const [hasMailchimp, setHasMailchimp] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleTest() {
    const to = (testTo || admin?.email || "").trim();
    setTesting(true);
    setTestMessage(null);
    try {
      const res = await fetch("/api/admin/campaigns/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, to, ctaLabel }),
      });
      const data = await res.json().catch(() => ({}));
      setTestMessage(res.ok ? { text: `Test sent to ${to}. Check the inbox and the spam folder.`, ok: true } : { text: data.error || "The test could not be sent.", ok: false });
    } catch {
      setTestMessage({ text: "Couldn't reach the server. Try again.", ok: false });
    } finally {
      setTesting(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ audience });
      const [countsRes, campaignsRes] = await Promise.all([
        fetch(`/api/admin/campaigns/audience-counts?${params.toString()}`),
        fetch("/api/admin/campaigns"),
      ]);
      if (countsRes.ok) {
        const data = await countsRes.json();
        setCounts(data.counts);
      }
      if (campaignsRes.ok) {
        const data = await campaignsRes.json();
        setCampaigns(data.campaigns);
        setHasMailchimp(Boolean(data.mailchimp));
      }
    } catch {
      // Network hiccup — keep showing the last data; the next poll will retry.
    } finally {
      setLoading(false);
    }
  }, [audience]);

  useEffect(() => {
    load();
  }, [load]);

  const recipientCount = counts[audience] ?? 0;
  const canSend = subject.trim() !== "" && body.trim() !== "" && recipientCount > 0;

  async function handleDelete(c: Campaign) {
    if (
      !window.confirm(
        `Delete the campaign "${c.subject}"? Its results are removed from this dashboard. Emails already sent can't be recalled.`
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/campaigns/${c.id}`, { method: "DELETE" });
    if (res.ok) {
      if (openCampaignId === c.id) setOpenCampaignId(null);
      setMessage({ text: "Campaign deleted.", ok: true });
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setMessage({ text: data.error || "Failed to delete.", ok: false });
    }
  }

  async function handleSend() {
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch(hasMailchimp ? "/api/admin/campaigns/mailchimp" : "/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, subject, body, ctaLabel }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubject("");
        setBody("");
        setStep("compose");
        let { sentCount, failedCount, waitingCount } = data.campaign as { sentCount: number; failedCount: number; waitingCount: number };
        let blocked: string | null = data.blocked ?? null;
        let lost: string | null = null;
        // The server sends in short runs. Keep asking until the campaign is finished, or no sender can send.
        if (waitingCount > 0 && !blocked) {
          const r = await flushUntilDone({
            campaignId: data.campaign.id,
            onProgress: (p) => setMessage({ text: `Sending… ${sentCount + p.sent} of ${data.campaign.recipientCount} sent. Keep this page open.`, ok: true }),
          });
          sentCount += r.sent;
          failedCount += r.failed;
          waitingCount = r.waiting;
          blocked = r.blocked;
          lost = r.error ?? null;
        }
        const viaMailchimp = hasMailchimp;
        const skipped = data.skipped?.alreadyGot || data.skipped?.alreadyWaiting ? ` ${(data.skipped.alreadyGot ?? 0) + (data.skipped.alreadyWaiting ?? 0)} people already had this email or were already waiting for it, so they were left out.` : "";
        if (viaMailchimp) {
          setMessage({
            text: `Sent with Mailchimp to ${sentCount} of ${data.campaign.recipientCount}.${failedCount ? ` ${failedCount} were left out because they unsubscribed or were refused in Mailchimp.` : ""}${skipped}`,
            ok: true,
          });
          load();
          return;
        }
        setMessage({
          text: `Sent to ${sentCount} of ${data.campaign.recipientCount}${failedCount ? ` (${failedCount} failed)` : ""}.${waitingCount ? ` ${waitingCount} are still waiting${blocked ? `: ${summarizeBlocked(blocked)}` : lost ? `: ${summarizeBlocked(lost)}` : ""}. Nothing is lost. They go out when you press Send waiting emails now, or at the next daily run.` : ""}${skipped}`,
          ok: !blocked && !lost,
        });
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
    <AdminShell>
      <>
      <div className="mb-6">
        <h2 className="font-serif text-3xl">Campaigns</h2>
        <p className="text-muted text-sm mt-1.5">
          Send a one-off email to a group of guests, for example a note before the day. Invitations, reminders and tickets are separate: they are sent from the Attendance page.
        </p>
      </div>

      {hasMailchimp ? (
        <>
          <div className="border border-border rounded-xl p-5 mb-8">
            <h3 className="font-medium text-sm">Sent with Mailchimp</h3>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              Campaigns go out through Mailchimp. Guests are added to your Mailchimp audience, and anyone who unsubscribed there is skipped. Invitations, reminders, tickets and confirmations are sent with Gmail.
            </p>
          </div>
          <SenderStrip onChange={load} waitingOnly />
        </>
      ) : (
        <SenderStrip onChange={load} />
      )}

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
          placeholder="e.g. A quick update ahead of the Hangout"
          className="w-full bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm mb-4 focus:outline-none focus:border-gold"
        />

        <label className="block text-xs uppercase tracking-wider text-muted mb-2">Message</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          placeholder="Type the message everyone in this segment will get. A blank line starts a new paragraph."
          className="w-full bg-inputbg border border-border rounded-lg px-4 py-3 text-sm mb-2 focus:outline-none focus:border-gold font-mono"
        />
        <p className="text-xs text-muted mb-5">
          Use {"{{first_name}}"} or {"{{full_name}}"} to personalize.
        </p>

        <div className="border border-border rounded-xl p-4 mb-5">
          <label className="flex items-start gap-2.5 text-sm cursor-pointer">
            <input type="checkbox" checked={withButton} onChange={(e) => setWithButton(e.target.checked)} className="mt-1 accent-[rgb(var(--c-gold))]" />
            <span>
              <span className="font-medium">Add a reserve button</span>
              <span className="block text-xs text-muted mt-1 leading-relaxed">
                Each guest gets a button under your message that opens their own reserve page, where one click reserves their seat and emails their ticket. Use your message to explain what reserving means and how limited the seats are.
                You can also put {"{{reserve_link}}"} inside the text.
              </span>
            </span>
          </label>
          {withButton && (
            <div className="mt-3">
              <label className="block text-xs uppercase tracking-wider text-muted mb-2" htmlFor="cta-label">
                Button text
              </label>
              <input
                id="cta-label"
                value={buttonLabel}
                onChange={(e) => setButtonLabel(e.target.value)}
                maxLength={40}
                placeholder={terms.action}
                className="w-full sm:w-72 bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold"
              />
            </div>
          )}
        </div>

        <div className="border border-border rounded-xl p-4 mb-5">
          <p className="text-xs uppercase tracking-wider text-muted mb-2">Send a test first</p>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder={admin?.email ?? "you@example.com"}
              className="flex-1 min-w-[14rem] bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold"
            />
            <button
              onClick={handleTest}
              disabled={testing || subject.trim() === "" || body.trim() === "" || !(testTo || admin?.email)}
              className="text-sm px-4 py-2.5 rounded-full border border-border text-fg hover:border-gold transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? "Sending…" : "Send test"}
            </button>
          </div>
          <p className="text-xs text-muted mt-2">Goes to this one address only, marked [TEST]. Nobody on the list is emailed and nothing is recorded.</p>
          {testMessage && <p className={`text-sm mt-2 ${testMessage.ok ? "text-goldlight" : "text-red-400"}`}>{testMessage.text}</p>}
        </div>

        {message && (
          <p className={`text-sm mb-4 ${message.ok ? "text-goldlight" : "text-red-400"}`}>{message.text}</p>
        )}

        {step === "compose" && (
          <button
            onClick={() => setStep("confirm")}
            disabled={!canSend}
            className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-[#141C08] font-semibold uppercase tracking-widest disabled:opacity-50"
          >
            Continue
          </button>
        )}

        {step === "confirm" && (
          <div className="border border-gold/30 rounded-xl p-4">
            <p className="text-sm mb-4">
              This will send to <span className="text-goldlight">{recipientCount}</span>{" "}
              {audienceLabel(audience).toLowerCase()}. Continue?
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
                className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-[#141C08] font-semibold uppercase tracking-widest disabled:opacity-60"
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
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Date</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap"></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setOpenCampaignId(c.id)}
                      className="border-b border-border/50 last:border-b-0 cursor-pointer hover:bg-gold/5"
                    >
                      <td className="px-5 py-4 whitespace-nowrap font-medium">{c.subject}</td>
                      <td className="px-5 py-4 text-muted whitespace-nowrap">
                        {audienceLabel(c.audience)}
                      </td>
                      <td className="px-5 py-4 text-muted whitespace-nowrap">
                        {new Date(c.sentAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-right space-x-4" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setOpenCampaignId(c.id)} className="text-goldlight hover:underline">
                          View
                        </button>
                        {isOwner && (
                          <button onClick={() => handleDelete(c)} className="text-red-400 hover:underline">
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      {openCampaignId && <CampaignDialog campaignId={openCampaignId} onClose={() => setOpenCampaignId(null)} />}
    </AdminShell>
  );
}