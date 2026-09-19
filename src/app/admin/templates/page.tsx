"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";

interface Template {
  key: string;
  subject: string;
  body: string;
  replyTo: string | null;
}

const LABELS: Record<string, string> = {
  registration_confirmation: "Registration confirmation email",
  brochure_confirmation: "Brochure email",
  payment_reminder: "Payment reminder email",
  seat_selection_invite: "Seat-selection invite email",
};

// Where each email is sent from, so admins know where to find the send button.
const WHEN_SENT: Record<string, string> = {
  registration_confirmation: "Sent automatically when someone registers. Resend from Registrations → ⋯.",
  brochure_confirmation: "Sent automatically on a brochure request. Resend from Brochure Requests.",
  payment_reminder: "Sent manually from Registrations or Payments → ⋯ → Send payment reminder.",
  seat_selection_invite: "Sent manually from Registrations or Payments → ⋯ → Send seat-selection invite (once fully paid).",
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
          className="w-full bg-black/30 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold"
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
          className="w-full bg-black/30 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold"
        />
      </div>

      <div className="mb-4">
        <label className="block text-xs uppercase tracking-wider text-muted mb-2">Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          className="w-full bg-black/30 border border-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-gold font-mono"
        />
        <p className="text-xs text-muted mt-2">
          Use {"{{first_name}}"} or {"{{full_name}}"} to personalize. A blank line starts a new
          paragraph. Any value from Settings also works as {"{{setting_key}}"} — for example{" "}
          {"{{programme_name}}"}, {"{{cohort_dates}}"}, {"{{registration_fee}}"}, {"{{early_bird_deadline}}"},{" "}
          {"{{payment_account_number}}"}, {"{{brochure_url}}"}. Registration emails can also use{" "}
          {"{{email}}"}, {"{{phone}}"}, {"{{country}}"}, {"{{organization}}"}, {"{{reg_type_label}}"} and{" "}
          {"{{registration_id}}"}.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {message && <span className="text-sm text-muted">{message}</span>}
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
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
    <AdminShell active="/admin/templates">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">Emails & WhatsApp</h2>
        <p className="text-muted text-sm mt-1">
          Edit the emails your attendees receive. Internal team alerts are built into the system and
          are configured by the Internal Notification Email in Settings.
        </p>
      </div>

      {loading && <p className="text-muted">Loading…</p>}
      {!loading &&
        templates.map((t) => <TemplateEditor key={t.key} template={t} onSaved={load} />)}
    </AdminShell>
  );
}
