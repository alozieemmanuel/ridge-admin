"use client";

import { useEffect, useState, useCallback } from "react";
import { useEvent, useEventPath, useTerms } from "@/lib/useEvent";
import AdminShell from "@/components/AdminShell";
import { flushUntilDone } from "@/lib/flushQueue";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { useIsOwner } from "@/lib/useIsOwner";
import Pagination from "@/components/Pagination";
import SenderStrip from "@/components/SenderStrip";
import { getStoredPageSize, storePageSize } from "@/lib/clientCache";

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
  category?: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  waitingCount?: number;
  sentAt: string;
  sentByName: string | null;
  delivered?: number;
  opened?: number;
  bounced?: number;
  complained?: number;
}

interface CampaignStats {
  delivered: number;
  opened: number;
  bounced: number;
  complained: number;
}

function percent(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

function StatCard({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone: string }) {
  return (
    <div className="border border-border rounded-xl px-5 py-4">
      <div className="text-xs uppercase tracking-wider text-muted mb-2">{label}</div>
      <div className={`font-serif text-2xl ${tone}`}>{value}</div>
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  );
}

interface Recipient {
  registrationId: string;
  fullName: string;
  email: string;
  status: "FAILED" | "SENT" | "DELIVERED" | "OPENED" | "BOUNCED" | "COMPLAINED";
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  error: string | null;
}

interface CampaignDetail extends Campaign {
  body: string;
}

const STATUS_LABEL: Record<Recipient["status"], { text: string; tone: string }> = {
  FAILED: { text: "Failed", tone: "text-red-400" },
  SENT: { text: "Sent", tone: "text-muted" },
  DELIVERED: { text: "Delivered", tone: "text-emerald-400" },
  OPENED: { text: "Opened", tone: "text-goldlight" },
  BOUNCED: { text: "Bounced", tone: "text-red-400" },
  COMPLAINED: { text: "Marked as spam", tone: "text-red-400" },
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "OPENED", label: "Opened" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "SENT", label: "Sent only" },
  { value: "BOUNCED", label: "Bounced" },
  { value: "FAILED", label: "Failed" },
];

/** One campaign in full: the email that went out, how it performed, and what happened to each recipient. */
function CampaignDialog({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => Math.min(getStoredPageSize(), 50));
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (query) params.set("search", query);
      if (status) params.set("status", status);
      const res = await fetch(`/api/admin/campaigns/${campaignId}?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Couldn't load this campaign.");
        return;
      }
      const data = await res.json();
      setDetail(data.campaign);
      setRecipients(data.recipients);
      setTotal(data.total);
      setError(null);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, [campaignId, page, pageSize, query, status]);

  useEffect(() => {
    load();
  }, [load]);

  // Opens and bounces keep arriving after the send.
  useAutoRefresh(() => load(), 15_000);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const delivered = detail?.delivered ?? 0;
  const opened = detail?.opened ?? 0;
  const bounced = detail?.bounced ?? 0;
  const complained = detail?.complained ?? 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div
        className="bg-pagebg border border-border rounded-2xl w-full max-w-4xl my-8 p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted mb-1">Campaign</p>
            <h3 className="font-serif text-2xl break-words">{detail?.subject ?? (loading ? "Loading…" : "Campaign")}</h3>
            {detail && (
              <p className="text-sm text-muted mt-1">
                {audienceLabel(detail.audience)} · {new Date(detail.sentAt).toLocaleString()}
                {detail.sentByName ? ` · by ${detail.sentByName}` : ""}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg text-2xl leading-none" aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        {detail && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <StatCard label="Sent" value={detail.sentCount} hint={`of ${detail.recipientCount}${detail.failedCount ? ` · ${detail.failedCount} failed` : ""}`} tone="text-fg" />
              <StatCard label="Delivered" value={delivered} hint={`${percent(delivered, detail.sentCount)} of sent`} tone="text-emerald-400" />
              <StatCard label="Opened" value={opened} hint={`${percent(opened, delivered)} of delivered`} tone="text-emerald-400" />
              <StatCard label="Bounced" value={bounced} hint={`${percent(bounced, detail.sentCount)} of sent`} tone="text-red-400" />
              <StatCard label="Complained" value={complained} hint="Marked as spam" tone="text-red-400" />
            </div>

            <p className="text-xs uppercase tracking-wider text-muted mb-2">Message</p>
            <div className="border border-border rounded-xl p-5 mb-2 max-h-72 overflow-y-auto">
              <p className="text-sm font-medium mb-3">{detail.subject}</p>
              <div className="text-sm text-muted whitespace-pre-wrap">{detail.body}</div>
            </div>
            <p className="text-xs text-muted mb-6">
              Shown as written. {"{{first_name}}"} and {"{{full_name}}"} were filled in for each person.
            </p>

            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => {
                    setStatus(f.value);
                    setPage(1);
                  }}
                  className={`text-sm px-3.5 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
                    status === f.value ? "border-gold text-goldlight bg-gold/10" : "border-border text-muted"
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email"
                className="bg-inputbg border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-gold ml-auto max-w-[14rem] w-full"
              />
            </div>

            <div className="border border-border rounded-xl overflow-hidden">
              <div className="table-scroll overflow-auto max-h-[45vh]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                      <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Name</th>
                      <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Email</th>
                      <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Status</th>
                      <th className="sticky top-0 z-20 bg-pagebg px-5 py-3 font-medium whitespace-nowrap">Opened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-5 py-8 text-center text-muted">
                          {loading ? "Loading…" : "No recipients match."}
                        </td>
                      </tr>
                    )}
                    {recipients.map((r) => (
                      <tr key={r.registrationId} className="border-b border-border/50 last:border-b-0">
                        <td className="px-5 py-3 whitespace-nowrap font-medium">{r.fullName}</td>
                        <td className="px-5 py-3 whitespace-nowrap text-muted">{r.email}</td>
                        <td className={`px-5 py-3 whitespace-nowrap ${STATUS_LABEL[r.status].tone}`} title={r.error ?? ""}>
                          {STATUS_LABEL[r.status].text}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap text-muted">
                          {r.openedAt ? new Date(r.openedAt).toLocaleString() : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPage={setPage}
                onPageSize={(n) => {
                  storePageSize(n);
                  setPageSize(n);
                  setPage(1);
                }}
              />
            </div>
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
  const [stats, setStats] = useState<CampaignStats>({ delivered: 0, opened: 0, bounced: 0, complained: 0 });
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<"compose" | "confirm">("compose");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const { admin } = useEvent();
  const terms = useTerms();
  const [withButton, setWithButton] = useState(false);
  const [buttonLabel, setButtonLabel] = useState("");
  const ctaLabel = withButton ? (buttonLabel.trim() || terms.action) : undefined;
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
        if (data.stats) setStats(data.stats);
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

  // Opens and bounces arrive from Brevo after the send, so refresh in the background.
  useAutoRefresh(() => load(), 15_000);

  const recipientCount = counts[audience] ?? 0;
  const canSend = subject.trim() !== "" && body.trim() !== "" && recipientCount > 0;

  const totalSent = campaigns.reduce((sum, c) => sum + c.sentCount, 0);

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
      const res = await fetch("/api/admin/campaigns", {
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
        const skipped = data.skipped?.alreadyGot || data.skipped?.alreadyWaiting ? ` ${(data.skipped.alreadyGot ?? 0) + (data.skipped.alreadyWaiting ?? 0)} people already had this email or were already waiting for it, so they were left out.` : "";
        setMessage({
          text: `Sent to ${sentCount} of ${data.campaign.recipientCount}${failedCount ? ` (${failedCount} failed)` : ""}.${waitingCount ? ` ${waitingCount} are still waiting${blocked ? `: ${blocked}` : lost ? `: ${lost}` : ""}. Nothing is lost. They go out when you press Send waiting emails now, or at the next daily run.` : ""}${skipped}`,
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

      <SenderStrip onChange={load} />

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

      <h3 className="font-serif text-xl mb-4">Campaign results</h3>

      {!loading && campaigns.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="Delivered"
            value={stats.delivered}
            hint={`${percent(stats.delivered, totalSent)} of sent`}
            tone="text-emerald-400"
          />
          <StatCard
            label="Opened"
            value={stats.opened}
            hint={`${percent(stats.opened, stats.delivered)} of delivered`}
            tone="text-emerald-400"
          />
          <StatCard
            label="Bounced"
            value={stats.bounced}
            hint={`${percent(stats.bounced, totalSent)} of sent`}
            tone="text-red-400"
          />
          <StatCard
            label="Complained"
            value={stats.complained}
            hint="Marked as spam"
            tone="text-red-400"
          />
        </div>
      )}

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
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Delivered</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Opened</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Bounced</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Date</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap"></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const delivered = c.delivered ?? 0;
                  const opened = c.opened ?? 0;
                  const bounced = c.bounced ?? 0;
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
                        {c.sentCount} of {c.recipientCount}
                        {c.failedCount > 0 && <span className="text-red-400"> ({c.failedCount} failed)</span>}
                        {(c.waitingCount ?? 0) > 0 && <span className="text-amber-400"> ({c.waitingCount} waiting)</span>}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-emerald-400">
                        {delivered}
                        <span className="text-muted ml-1.5">{percent(delivered, c.sentCount)}</span>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-emerald-400">
                        {opened}
                        <span className="text-muted ml-1.5">{percent(opened, delivered)}</span>
                      </td>
                      <td className={`px-5 py-4 whitespace-nowrap ${bounced > 0 ? "text-red-400" : "text-muted"}`}>
                        {bounced}
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
          <p className="px-5 py-3 text-xs text-muted border-t border-border">
            Open counts are approximate. Some mail apps block the tracking pixel, and others open every message
            automatically. Campaigns sent before this update show zeros here.
          </p>
        </div>
      )}
      </>
      {openCampaignId && <CampaignDialog campaignId={openCampaignId} onClose={() => setOpenCampaignId(null)} />}
    </AdminShell>
  );
}