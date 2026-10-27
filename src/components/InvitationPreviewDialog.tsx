"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useEvent, useEventPath } from "@/lib/useEvent";
import { ghostButton, inputClass, primaryButton } from "@/components/ui";

type Kind = "invitation" | "reminder";

/**
 * Shows exactly what the invitation (or the reminder) looks like, with you as the guest, and lets you send it to yourself first.
 * Nobody on the list is emailed from here.
 */
export default function InvitationPreviewDialog({ initial = "invitation", onClose }: { initial?: Kind; onClose: () => void }) {
  const ep = useEventPath();
  const { admin } = useEvent();
  const [kind, setKind] = useState<Kind>(initial);
  const [mail, setMail] = useState<{ subject: string; html: string; replyTo: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    setMail(null);
    setError(null);
    fetch("/api/admin/attendance/invite/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.ok) setMail(json);
        else setError(json.error || "Couldn't build the preview.");
      })
      .catch(() => alive && setError("Couldn't reach the server."));
    return () => {
      alive = false;
    };
  }, [kind]);

  async function sendTest() {
    const address = (to || admin?.email || "").trim();
    setSending(true);
    setNote(null);
    const res = await fetch("/api/admin/attendance/invite/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, to: address }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setSending(false);
    setNote(res?.ok ? { text: `Test sent to ${address}. Check the inbox and the spam folder.`, ok: true } : { text: json.error || "The test could not be sent.", ok: false });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-pagebg border border-border rounded-2xl w-full max-w-2xl my-8 p-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Email preview">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="font-serif text-2xl">Preview the email</h3>
            <p className="text-sm text-muted mt-1">This is what each guest receives, with you as the sample guest. Their own name and their own Reserve My Seat link go in.</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg text-3xl leading-none" aria-label="Close">
            ×
          </button>
        </div>

        <div className="flex gap-1.5 mb-4" role="tablist">
          {(["invitation", "reminder"] as Kind[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={`text-sm px-4 py-2 rounded-full border transition-colors ${kind === k ? "border-gold bg-gold/15 font-medium" : "border-border text-muted hover:text-fg"}`}
            >
              {k === "invitation" ? "Invitation" : "Reminder"}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        {!mail && !error && <p className="text-muted text-sm py-10 text-center">Loading the preview…</p>}
        {mail && (
          <>
            <div className="text-sm mb-3 space-y-1">
              <p>
                <span className="text-muted">Subject: </span>
                <strong>{mail.subject}</strong>
              </p>
              {mail.replyTo && (
                <p>
                  <span className="text-muted">Replies go to: </span>
                  {mail.replyTo}
                </p>
              )}
            </div>
            <iframe title="Email preview" srcDoc={`<html><body style="margin:0;background:#fff">${mail.html}</body></html>`} sandbox="" className="w-full h-[34rem] rounded-xl border border-border bg-white" />
          </>
        )}

        <div className="border border-border rounded-xl p-4 mt-5">
          <p className="text-xs uppercase tracking-wider text-muted mb-2">Send it to yourself first</p>
          <div className="flex items-center gap-3 flex-wrap">
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder={admin?.email ?? "you@example.com"} className={`${inputClass} flex-1 min-w-[14rem]`} />
            <button onClick={sendTest} disabled={sending || !mail || !(to || admin?.email)} className={primaryButton}>
              {sending ? "Sending…" : "Send test"}
            </button>
          </div>
          <p className="text-xs text-muted mt-2">Goes to this one address only, marked [TEST]. The button in the test does nothing. Nobody on the list is emailed.</p>
          {note && <p className={`text-sm mt-2 ${note.ok ? "text-goldlight" : "text-red-400"}`}>{note.text}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap mt-5">
          <Link href={ep("/settings?tab=templates")} className="text-sm text-goldlight underline">
            Change the wording
          </Link>
          <button onClick={onClose} className={ghostButton}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
