"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FOLLOW_UP_STATUSES, followUpLabel, followUpTone } from "@/lib/followUp";
import { useIsOwner } from "@/lib/useIsOwner";
import { cacheDeletePrefix, cacheGet, cacheSet } from "@/lib/clientCache";
import { Pill, formatDateTime, ghostButton, inputClass, primaryButton } from "@/components/ui";

interface FollowUp {
  id: string;
  status: string | null;
  body: string;
  authorName: string | null;
  createdAt: string;
}
interface Activity {
  id: string;
  title: string;
  detail: string | null;
  by: string;
  at: string;
  tone: "normal" | "good" | "bad";
}
interface Participant {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  followUpStatus: string;
  extra: Record<string, string>;
  inviteSentAt: string | null;
  reservedAt: string | null;
  ticketCode: string | null;
  ticketSentAt: string | null;
  checkedInAt: string | null;
  createdAt: string;
  reserveLink: string;
  followUps: FollowUp[];
  activity: Activity[];
}

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-border rounded-xl p-5 sm:p-6 bg-cardbg">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-xs uppercase tracking-wider text-muted">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || "-"}</dd>
    </div>
  );
}

/** Forgets the lists and counts that this guest's change affects, so they are fetched fresh the next time they open. */
function invalidateLists() {
  cacheDeletePrefix("/api/admin/registrations?");
  cacheDeletePrefix("/api/admin/overview");
}

/** One guest's full record: contact, follow-up log, invitation / seat / ticket, and everything that has happened to them. */
export default function GuestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const isOwner = useIsOwner();
  const url = `/api/admin/registrations/${id}`;
  const [p, setP] = useState<Participant | null>(() => cacheGet<{ participant: Participant }>(url)?.participant ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", phone: "" });
  // The follow-up status the admin has just clicked and is writing feedback for. null = the box is closed.
  const [logging, setLogging] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Couldn't open this guest.");
        return;
      }
      const data = await res.json();
      cacheSet(url, data);
      setP(data.participant);
      setError(null);
    } catch {
      setError("Couldn't reach the server. Check your connection and refresh.");
    }
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  // The notice stays on screen for a few seconds, wherever the admin has scrolled to.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), message.ok ? 4000 : 9000);
    return () => clearTimeout(t);
  }, [message]);

  async function call(target: string, init: RequestInit, key: string): Promise<{ ok: boolean; json: Record<string, unknown> }> {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch(target, { ...init, headers: { "Content-Type": "application/json" } });
      return { ok: res.ok, json: await res.json().catch(() => ({})) };
    } catch {
      return { ok: false, json: { error: "Couldn't reach the server. Try again." } };
    } finally {
      setBusy(null);
    }
  }

  async function changed(text: string, ok = true) {
    setMessage({ text, ok });
    invalidateLists();
    await load();
  }

  async function act(action: string, success: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    const { ok, json } = await call(`${url}/actions`, { method: "POST", body: JSON.stringify({ action }) }, action);
    if (!ok) {
      setMessage({ text: String(json.error || "That didn't work."), ok: false });
      await load(); // a failed send is written to the activity, so show it
      return;
    }
    const ticketNote = action === "reserve" && json.ticketSent === false ? ` The ticket email failed (${json.ticketError}); use Send ticket to retry.` : "";
    await changed(success + ticketNote, ticketNote === "");
  }

  async function saveDetails() {
    const { ok, json } = await call(url, { method: "PATCH", body: JSON.stringify(form) }, "patch");
    if (!ok) return setMessage({ text: String(json.error || "Couldn't save."), ok: false });
    setEditing(false);
    await changed("Details saved.");
  }

  async function saveFollowUp() {
    if (!logging) return;
    const { ok, json } = await call(`${url}/follow-up`, { method: "POST", body: JSON.stringify({ status: logging, feedback }) }, "followup");
    if (!ok) return setMessage({ text: String(json.error || "Couldn't save."), ok: false });
    setLogging(null);
    setFeedback("");
    await changed("Follow-up logged.");
  }

  async function removeFollowUp(noteId: string) {
    if (!window.confirm("Delete this follow-up entry? The deletion is recorded in the activity.")) return;
    const { ok, json } = await call(`${url}/notes`, { method: "DELETE", body: JSON.stringify({ noteId }) }, "note");
    if (!ok) return setMessage({ text: String(json.error || "Couldn't delete."), ok: false });
    await changed("Entry deleted.");
  }

  async function remove() {
    if (!p || !window.confirm(`Permanently delete ${p.fullName} from the guest list? This cannot be undone.`)) return;
    const { ok, json } = await call(url, { method: "DELETE" }, "delete");
    if (!ok) return setMessage({ text: String(json.error || "Couldn't delete."), ok: false });
    invalidateLists();
    router.push("/admin/registrations");
  }

  async function copyLink() {
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p.reserveLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      setMessage({ text: "Reserve link copied.", ok: true });
    } catch {
      window.prompt("Copy this link:", p.reserveLink);
    }
  }

  const reserved = Boolean(p?.reservedAt);
  const loggingLabel = logging ? followUpLabel(logging) : "";

  return (
    <>
      <Link href="/admin/registrations" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg mb-5">
        <span aria-hidden>←</span> Back to contacts
      </Link>

      {message && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border px-4 py-3 text-sm shadow-lg bg-cardbg ${message.ok ? "border-gold" : "border-red-400/60 text-red-400"}`}
        >
          {message.text}
        </div>
      )}

      {error && !p && <p className="text-sm text-red-400">{error}</p>}
      {!p && !error && <p className="text-muted">Loading…</p>}

      {p && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted mb-1">Guest</p>
              <h2 className="font-serif text-3xl sm:text-4xl break-words">{p.fullName}</h2>
              <p className="text-muted text-sm mt-1.5">Added {formatDateTime(p.createdAt)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={followUpTone(p.followUpStatus)}>{followUpLabel(p.followUpStatus)}</Pill>
              <Pill tone={reserved ? "text-emerald-400" : p.inviteSentAt ? "text-amber-300" : "text-muted"}>{reserved ? "Seat reserved" : p.inviteSentAt ? "Invited" : "Not invited"}</Pill>
              {p.checkedInAt && <Pill tone="text-emerald-400">Checked in</Pill>}
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-6 items-start">
            {/* Left, wide: contact, then the follow-up, then everything that has happened */}
            <div className="lg:col-span-2 space-y-6">
              <Card
                title="Contact"
                aside={
                  !editing && (
                    <button
                      onClick={() => {
                        setForm({ fullName: p.fullName, email: p.email, phone: p.phone });
                        setEditing(true);
                      }}
                      className="text-xs text-goldlight hover:underline"
                    >
                      Edit
                    </button>
                  )
                }
              >
                {!editing ? (
                  <dl>
                    <Row label="Name">{p.fullName}</Row>
                    <Row label="Email">
                      <a href={`mailto:${p.email}`} className="text-goldlight underline">
                        {p.email}
                      </a>
                    </Row>
                    <Row label="Phone">
                      {p.phone ? (
                        <a href={`tel:${p.phone}`} className="text-goldlight underline">
                          {p.phone}
                        </a>
                      ) : null}
                    </Row>
                  </dl>
                ) : (
                  <div className="space-y-3">
                    {(
                      [
                        ["fullName", "Full name"],
                        ["email", "Email address"],
                        ["phone", "Phone number"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="block">
                        <span className="block text-xs uppercase tracking-wider text-muted mb-1.5">{label}</span>
                        <input value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className={inputClass} />
                      </label>
                    ))}
                    <div className="flex gap-3 pt-1">
                      <button onClick={() => setEditing(false)} className={ghostButton}>
                        Cancel
                      </button>
                      <button disabled={busy === "patch"} className={primaryButton} onClick={saveDetails}>
                        {busy === "patch" ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                )}
              </Card>

              <Card title="Follow-up">
                <p className="text-sm text-muted mb-3">Pick the outcome of your call. You can add what was said, and it is saved here with the time and your name.</p>
                <div className="flex flex-wrap gap-2">
                  {FOLLOW_UP_STATUSES.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => {
                        setLogging(logging === s.value ? null : s.value);
                        setFeedback("");
                      }}
                      aria-pressed={logging === s.value}
                      className={`text-sm px-3.5 py-1.5 rounded-full border transition-colors ${
                        logging === s.value
                          ? "border-gold bg-gold/25 font-medium"
                          : p.followUpStatus === s.value
                            ? "border-gold/70 bg-gold/10 font-medium"
                            : "border-border text-muted hover:text-fg hover:border-gold/60"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                {logging && (
                  <div className="mt-4 border border-gold/50 rounded-xl p-4 bg-tint">
                    <label className="block text-xs uppercase tracking-wider text-muted mb-2" htmlFor="feedback">
                      {loggingLabel}: what was said?
                    </label>
                    <textarea
                      id="feedback"
                      autoFocus
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      rows={4}
                      placeholder="Write the feedback from the call (you can leave this empty)."
                      className={inputClass}
                    />
                    <div className="flex gap-3 mt-3">
                      <button onClick={saveFollowUp} disabled={busy === "followup"} className={primaryButton}>
                        {busy === "followup" ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={() => {
                          setLogging(null);
                          setFeedback("");
                        }}
                        className={ghostButton}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-6 border-t border-border pt-4">
                  <h4 className="text-xs uppercase tracking-wider text-muted mb-3">Follow-up log</h4>
                  {p.followUps.length === 0 ? (
                    <p className="text-sm text-muted">Nothing logged yet.</p>
                  ) : (
                    <ul className="space-y-4">
                      {p.followUps.map((n) => (
                        <li key={n.id} className="text-sm">
                          <p className="font-medium">{followUpLabel(n.status)}</p>
                          {n.body && <p className="whitespace-pre-wrap break-words text-muted mt-0.5">{n.body}</p>}
                          <p className="text-xs text-muted mt-1">
                            {n.authorName ? `${n.authorName} · ` : ""}
                            {formatDateTime(n.createdAt)}
                            {isOwner && (
                              <>
                                {" · "}
                                <button onClick={() => removeFollowUp(n.id)} className="text-red-400 hover:underline">
                                  Delete
                                </button>
                              </>
                            )}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>

              <Card title="Activity">
                <ul className="space-y-4">
                  {p.activity.map((a) => (
                    <li key={a.id} className="flex gap-3 text-sm">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.tone === "bad" ? "bg-red-400" : a.tone === "good" ? "bg-emerald-400" : "bg-gold"}`} aria-hidden />
                      <div className="min-w-0">
                        <p className={a.tone === "bad" ? "text-red-400 font-medium" : "font-medium"}>{a.title}</p>
                        {a.detail && <p className="text-muted whitespace-pre-wrap break-words mt-0.5">{a.detail}</p>}
                        <p className="text-xs text-muted mt-0.5">
                          {a.by} · {formatDateTime(a.at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            {/* Right: the invitation, seat and ticket */}
            <div className="space-y-6">
              <Card title="Invitation, seat and ticket">
                <dl className="mb-4">
                  <Row label="Invitation sent">{p.inviteSentAt ? formatDateTime(p.inviteSentAt) : "Not yet"}</Row>
                  <Row label="Seat reserved">{p.reservedAt ? formatDateTime(p.reservedAt) : "Not yet"}</Row>
                  <Row label="Ticket code">{p.ticketCode ? <span className="font-mono tracking-wider">{p.ticketCode}</span> : null}</Row>
                  <Row label="Ticket emailed">{p.ticketSentAt ? formatDateTime(p.ticketSentAt) : reserved ? "Not yet" : "-"}</Row>
                  <Row label="Checked in">{p.checkedInAt ? formatDateTime(p.checkedInAt) : "No"}</Row>
                </dl>
                <div className="flex flex-wrap gap-2">
                  {!reserved && (
                    <button className={primaryButton} disabled={busy !== null} onClick={() => act(p.inviteSentAt ? "send_reminder" : "send_invitation", p.inviteSentAt ? "Reminder sent." : "Invitation sent.")}>
                      {busy === "send_invitation" || busy === "send_reminder" ? "Sending…" : p.inviteSentAt ? "Send reminder" : "Send invitation"}
                    </button>
                  )}
                  {!reserved && (
                    <button className={`${ghostButton} ${copied ? "border-gold bg-gold/15" : ""}`} onClick={copyLink} aria-live="polite">
                      {copied ? "Copied ✓" : "Copy reserve link"}
                    </button>
                  )}
                  {!reserved && (
                    <button className={ghostButton} disabled={busy !== null} onClick={() => act("reserve", "Seat reserved and ticket emailed.", `Reserve a seat for ${p.fullName} and email them their ticket?`)}>
                      {busy === "reserve" ? "Reserving…" : "Reserve for them"}
                    </button>
                  )}
                  {reserved && (
                    <button className={primaryButton} disabled={busy !== null} onClick={() => act("send_ticket", "Ticket sent.")}>
                      {busy === "send_ticket" ? "Sending…" : p.ticketSentAt ? "Resend ticket" : "Send ticket"}
                    </button>
                  )}
                  {reserved && !p.checkedInAt && (
                    <button className={ghostButton} disabled={busy !== null} onClick={() => act("check_in", "Checked in.")}>
                      {busy === "check_in" ? "Checking in…" : "Check in"}
                    </button>
                  )}
                  {reserved && p.checkedInAt && (
                    <button className={ghostButton} disabled={busy !== null} onClick={() => act("undo_check_in", "Check-in undone.")}>
                      {busy === "undo_check_in" ? "Undoing…" : "Undo check-in"}
                    </button>
                  )}
                  {reserved && !p.checkedInAt && (
                    <button
                      className={`${ghostButton} text-red-400`}
                      disabled={busy !== null}
                      onClick={() => act("release", "Reservation cancelled.", `Cancel ${p.fullName}'s reservation? Their ticket stops working and the seat is free again.`)}
                    >
                      {busy === "release" ? "Cancelling…" : "Cancel reservation"}
                    </button>
                  )}
                </div>
              </Card>

              {Object.keys(p.extra).length > 0 && (
                <Card title="More details from your list">
                  <dl>
                    {Object.entries(p.extra).map(([k, v]) => (
                      <Row key={k} label={k}>
                        {v}
                      </Row>
                    ))}
                  </dl>
                </Card>
              )}

              {isOwner && (
                <div>
                  <button onClick={remove} className="text-sm text-red-400 hover:underline">
                    Delete this guest
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
