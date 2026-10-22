"use client";

import { useCallback, useEffect, useState } from "react";
import { FOLLOW_UP_STATUSES, followUpLabel, followUpTone } from "@/lib/followUp";
import { useIsOwner } from "@/lib/useIsOwner";
import { Pill, formatDateTime, ghostButton, inputClass, primaryButton } from "@/components/ui";

interface Participant {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  organization: string | null;
  followUpStatus: string;
  callFeedback: string | null;
  extra: Record<string, string>;
  inviteSentAt: string | null;
  reservedAt: string | null;
  ticketCode: string | null;
  ticketSentAt: string | null;
  checkedInAt: string | null;
  createdAt: string;
  reserveLink: string;
  notes: { id: string; body: string; authorName: string | null; createdAt: string }[];
  emails: { id: string; kind: string | null; type: string; subject: string | null; error: string | null; at: string }[];
}

const EMAIL_KIND: Record<string, string> = {
  invitation: "Invitation",
  reminder: "Reminder",
  ticket: "Ticket",
};

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border border-border rounded-xl p-5 mb-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h4 className="text-xs uppercase tracking-wider text-muted">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || "-"}</dd>
    </div>
  );
}

/** Everything about one guest, with the actions for their invitation, seat, ticket and check-in. Slides in from the right. */
export default function ParticipantDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const isOwner = useIsOwner();
  const [p, setP] = useState<Participant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", organization: "" });
  const [feedback, setFeedback] = useState("");
  const [feedbackDirty, setFeedbackDirty] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/registrations/${id}`, { cache: "no-store" });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Couldn't open this guest.");
      return;
    }
    const data = await res.json();
    setP(data.participant);
    setFeedback((prev) => (feedbackDirty ? prev : data.participant.callFeedback ?? ""));
    setError(null);
  }, [id, feedbackDirty]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function flash(text: string, ok: boolean) {
    setMessage({ text, ok });
  }

  async function call(url: string, init: RequestInit, key: string): Promise<{ ok: boolean; json: Record<string, unknown> }> {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, json };
    } catch {
      return { ok: false, json: { error: "Couldn't reach the server. Try again." } };
    } finally {
      setBusy(null);
    }
  }

  async function act(action: string, success: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    const { ok, json } = await call(`/api/admin/registrations/${id}/actions`, { method: "POST", body: JSON.stringify({ action }) }, action);
    if (!ok) return flash(String(json.error || "That didn't work."), false);
    const ticketNote = action === "reserve" && json.ticketSent === false ? ` The ticket email failed (${json.ticketError}); use Send ticket to retry.` : "";
    flash(success + ticketNote, ticketNote === "");
    await load();
    onChanged();
  }

  async function patch(body: Record<string, unknown>, success: string) {
    const { ok, json } = await call(`/api/admin/registrations/${id}`, { method: "PATCH", body: JSON.stringify(body) }, "patch");
    if (!ok) return flash(String(json.error || "Couldn't save."), false);
    flash(success, true);
    await load();
    onChanged();
    return true;
  }

  async function addNote() {
    if (!note.trim()) return;
    const { ok, json } = await call(`/api/admin/registrations/${id}/notes`, { method: "POST", body: JSON.stringify({ body: note }) }, "note");
    if (!ok) return flash(String(json.error || "Couldn't add the note."), false);
    setNote("");
    flash("Note added.", true);
    await load();
    onChanged();
  }

  async function removeNote(noteId: string) {
    if (!window.confirm("Delete this note?")) return;
    const { ok, json } = await call(`/api/admin/registrations/${id}/notes`, { method: "DELETE", body: JSON.stringify({ noteId }) }, "note");
    if (!ok) return flash(String(json.error || "Couldn't delete."), false);
    await load();
  }

  async function remove() {
    if (!p || !window.confirm(`Permanently delete ${p.fullName} from the guest list? This cannot be undone.`)) return;
    const { ok, json } = await call(`/api/admin/registrations/${id}`, { method: "DELETE" }, "delete");
    if (!ok) return flash(String(json.error || "Couldn't delete."), false);
    onChanged();
    onClose();
  }

  async function copyLink() {
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p.reserveLink);
      flash("Link copied.", true);
    } catch {
      window.prompt("Copy this link:", p.reserveLink);
    }
  }

  function startEdit() {
    if (!p) return;
    setForm({ fullName: p.fullName, email: p.email, phone: p.phone, organization: p.organization ?? "" });
    setEditing(true);
  }

  const reserved = Boolean(p?.reservedAt);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Guest details">
      <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full bg-pagebg border-l border-border overflow-y-auto">
        <div className="sticky top-0 z-10 bg-pagebg/95 backdrop-blur border-b border-border px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted">Guest</p>
            <h3 className="font-serif text-2xl break-words">{p?.fullName ?? (error ? "Not found" : "Loading…")}</h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg text-3xl leading-none -mt-1" aria-label="Close">
            ×
          </button>
        </div>

        <div className="px-6 py-5">
          {error && <p className="text-sm text-red-400">{error}</p>}
          {message && (
            <p className={`text-sm mb-4 rounded-lg border px-4 py-2.5 ${message.ok ? "border-gold/50 bg-gold/10" : "border-red-400/50 text-red-400"}`} role="status">
              {message.text}
            </p>
          )}

          {p && (
            <>
              <Section
                title="Contact"
                aside={
                  !editing && (
                    <button onClick={startEdit} className="text-xs text-goldlight hover:underline">
                      Edit
                    </button>
                  )
                }
              >
                {!editing ? (
                  <dl>
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
                    <Row label="Company">{p.organization}</Row>
                    <Row label="Added">{formatDateTime(p.createdAt)}</Row>
                  </dl>
                ) : (
                  <div className="space-y-3">
                    {(
                      [
                        ["fullName", "Full name"],
                        ["email", "Email address"],
                        ["phone", "Phone number"],
                        ["organization", "Company"],
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
                      <button
                        disabled={busy === "patch"}
                        className={primaryButton}
                        onClick={async () => {
                          if (await patch(form, "Details saved.")) setEditing(false);
                        }}
                      >
                        {busy === "patch" ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                )}
              </Section>

              <Section title="Follow-up">
                <div className="flex flex-wrap gap-2 mb-4">
                  {FOLLOW_UP_STATUSES.map((s) => (
                    <button
                      key={s.value}
                      disabled={busy === "patch"}
                      onClick={() => p.followUpStatus !== s.value && patch({ followUpStatus: s.value }, `Marked as “${s.label}”.`)}
                      aria-pressed={p.followUpStatus === s.value}
                      className={`text-sm px-3.5 py-1.5 rounded-full border transition-colors ${
                        p.followUpStatus === s.value ? "border-gold bg-gold/15 font-medium" : "border-border text-muted hover:text-fg hover:border-gold/60"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <label className="block text-xs uppercase tracking-wider text-muted mb-1.5">Call feedback (from your list)</label>
                <textarea
                  value={feedback}
                  onChange={(e) => {
                    setFeedback(e.target.value);
                    setFeedbackDirty(true);
                  }}
                  rows={3}
                  placeholder="No feedback came in with the list."
                  className={`${inputClass} mb-2`}
                />
                {feedbackDirty && (
                  <div className="flex gap-3 mb-2">
                    <button
                      className={primaryButton}
                      disabled={busy === "patch"}
                      onClick={async () => {
                        if (await patch({ callFeedback: feedback }, "Feedback saved.")) setFeedbackDirty(false);
                      }}
                    >
                      Save feedback
                    </button>
                    <button
                      className={ghostButton}
                      onClick={() => {
                        setFeedback(p.callFeedback ?? "");
                        setFeedbackDirty(false);
                      }}
                    >
                      Undo
                    </button>
                  </div>
                )}

                <h5 className="text-xs uppercase tracking-wider text-muted mt-5 mb-2">Call notes</h5>
                <div className="flex gap-2 mb-3">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What was said on the call?" className={inputClass} />
                  <button onClick={addNote} disabled={!note.trim() || busy === "note"} className={`${primaryButton} self-start`}>
                    Add
                  </button>
                </div>
                {p.notes.length === 0 ? (
                  <p className="text-sm text-muted">No notes yet.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {p.notes.map((n) => (
                      <li key={n.id} className="border border-border rounded-lg px-4 py-3 text-sm bg-tint">
                        <p className="whitespace-pre-wrap break-words">{n.body}</p>
                        <p className="text-xs text-muted mt-1.5 flex items-center justify-between gap-3">
                          <span>
                            {n.authorName ? `${n.authorName} · ` : ""}
                            {formatDateTime(n.createdAt)}
                          </span>
                          <button onClick={() => removeNote(n.id)} className="text-red-400 hover:underline">
                            Delete
                          </button>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Invitation, seat and ticket" aside={<Pill tone={reserved ? "text-emerald-400" : "text-muted"}>{reserved ? "Seat reserved" : "Not reserved"}</Pill>}>
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
                    <button className={ghostButton} onClick={copyLink}>
                      Copy reserve link
                    </button>
                  )}
                  {!reserved && (
                    <button className={ghostButton} disabled={busy !== null} onClick={() => act("reserve", "Seat reserved and ticket emailed.", `Reserve a seat for ${p.fullName} and email them their ticket?`)}>
                      Reserve for them
                    </button>
                  )}
                  {reserved && (
                    <button className={primaryButton} disabled={busy !== null} onClick={() => act("send_ticket", "Ticket sent.")}>
                      {busy === "send_ticket" ? "Sending…" : p.ticketSentAt ? "Resend ticket" : "Send ticket"}
                    </button>
                  )}
                  {reserved && !p.checkedInAt && (
                    <button className={ghostButton} disabled={busy !== null} onClick={() => act("check_in", "Checked in.")}>
                      Check in
                    </button>
                  )}
                  {reserved && p.checkedInAt && (
                    <button className={ghostButton} disabled={busy !== null} onClick={() => act("undo_check_in", "Check-in undone.")}>
                      Undo check-in
                    </button>
                  )}
                  {reserved && !p.checkedInAt && (
                    <button
                      className={`${ghostButton} text-red-400`}
                      disabled={busy !== null}
                      onClick={() => act("release", "Reservation cancelled.", `Cancel ${p.fullName}'s reservation? Their ticket stops working and the seat is free again.`)}
                    >
                      Cancel reservation
                    </button>
                  )}
                </div>
              </Section>

              {Object.keys(p.extra).length > 0 && (
                <Section title="More details from your list">
                  <dl>
                    {Object.entries(p.extra).map(([k, v]) => (
                      <Row key={k} label={k}>
                        {v}
                      </Row>
                    ))}
                  </dl>
                </Section>
              )}

              <Section title="Emails sent to them">
                {p.emails.length === 0 ? (
                  <p className="text-sm text-muted">No emails yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {p.emails.map((e) => (
                      <li key={e.id} className="py-2 text-sm flex items-start justify-between gap-3">
                        <span>
                          {EMAIL_KIND[e.kind ?? ""] ?? e.kind ?? "Email"}
                          {e.type === "FAILED" && <span className="text-red-400"> · failed{e.error ? `: ${e.error}` : ""}</span>}
                        </span>
                        <span className="text-xs text-muted whitespace-nowrap">{formatDateTime(e.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {isOwner && (
                <div className="pt-2 pb-6">
                  <button onClick={remove} className="text-sm text-red-400 hover:underline">
                    Delete this guest
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export { followUpLabel, followUpTone };
