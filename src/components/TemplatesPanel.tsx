"use client";

import { useEffect, useState } from "react";

interface Template {
  key: string;
  subject: string;
  body: string;
  replyTo: string | null;
}

const LABELS: Record<string, string> = {
  invitation: "Invitation email",
  reservation_reminder: "Reservation reminder email",
};

// Where each email is sent from, so admins know where to find the send button.
const WHEN_SENT: Record<string, string> = {
  invitation: "Sent from Attendance (to everyone not yet invited) or from a guest's page in Contacts. The Reserve My Seat button is added for you.",
  reservation_reminder: "Sent from Attendance (to guests who haven't reserved yet) or from a guest's page. The Reserve My Seat button is added for you.",
};

function TemplateEditor({ template, onSaved }: { template: Template; onSaved: () => void }) {
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [replyTo, setReplyTo] = useState(template.replyTo ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/admin/templates/${template.key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body, replyTo }),
    });
    setSaving(false);
    if (res.ok) {
      setMessage("Saved.");
      onSaved();
    } else {
      const data = await res.json().catch(() => ({}));
      setMessage(data.error || "Failed to save.");
    }
  }

  return (
    <div className="border border-border rounded-xl p-6 mb-6">
      <h3 className="text-gold text-sm font-semibold mb-1">{LABELS[template.key] ?? template.key}</h3>
      {WHEN_SENT[template.key] && <p className="text-xs text-muted mb-4">{WHEN_SENT[template.key]}</p>}

      <div className="mb-4">
        <label className="block text-xs uppercase tracking-wider text-muted mb-2">Reply-To Address</label>
        <input
          value={replyTo}
          onChange={(e) => setReplyTo(e.target.value)}
          placeholder="Leave empty to reply to the sending address"
          className="w-full bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold"
        />
        <p className="text-xs text-muted mt-2">
          An email address, or {"{{contact_email}}"} to use the Contact Email from Settings. Replies to this email go here.
        </p>
      </div>

      <div className="mb-4">
        <label className="block text-xs uppercase tracking-wider text-muted mb-2">Subject</label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold"
        />
      </div>

      <div className="mb-4">
        <label className="block text-xs uppercase tracking-wider text-muted mb-2">Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          className="w-full bg-inputbg border border-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-gold font-mono"
        />
        <p className="text-xs text-muted mt-2">
          Use {"{{first_name}}"} or {"{{full_name}}"} to personalize. A blank line starts a new
          paragraph. Any value from Settings also works, for example {"{{programme_name}}"}, {"{{event_date}}"},{" "}
          {"{{event_time}}"} and {"{{event_venue}}"}. You can also use {"{{email}}"} and {"{{phone}}"}.
          The date, time and venue are always shown in a box under the message, and the guest&apos;s own link is the button.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-[#141C08] font-semibold uppercase tracking-widest disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {message && <span className="text-sm text-muted">{message}</span>}
      </div>
    </div>
  );
}

/** The editors for the emails guests receive. Shown under Settings, on the Email templates tab. */
export default function TemplatesPanel() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/admin/templates");
    if (res.ok) {
      const data = await res.json();
      setTemplates(data.templates);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h3 className="font-serif text-xl">Email templates</h3>
        <p className="text-muted text-sm mt-1">
          Edit the wording of the emails your guests receive. The ticket email is designed automatically and is sent as soon as a guest reserves.
        </p>
      </div>

      {loading && <p className="text-muted">Loading…</p>}
      {!loading && templates.map((t) => <TemplateEditor key={t.key} template={t} onSaved={load} />)}
    </div>
  );
}
