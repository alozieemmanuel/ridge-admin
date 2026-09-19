"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";

const FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "programme_name", label: "Programme Name" },
  { key: "event_caption", label: "Event Caption" },
  { key: "cohort_dates", label: "Cohort Dates" },
  { key: "sender_name", label: "Email Sender Name" },
  { key: "registration_fee", label: "Early Bird Fee (display text)" },
  { key: "late_registration_fee", label: "Late Fee (display text)" },
  { key: "early_bird_deadline", label: "Early Bird Deadline" },
  { key: "brochure_url", label: "Brochure PDF URL" },
  { key: "payment_account_name", label: "Payment — Account Name" },
  { key: "payment_bank_name", label: "Payment — Bank Name" },
  { key: "payment_account_number", label: "Payment — Account Number" },
  { key: "currency", label: "Currency" },
  { key: "contact_email", label: "Contact Email" },
  {
    key: "notification_email",
    label: "Internal Notification Email",
    hint: "Where new-registration/brochure alerts are sent. Leave empty to disable.",
  },
  { key: "contact_whatsapp_number", label: "WhatsApp Number", hint: "Digits only, country code, no plus sign." },
  { key: "contact_whatsapp_message", label: "WhatsApp Pre-filled Message" },
];

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => res.json())
      .then((data) => setValues(data.settings))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setSaving(false);
    setMessage(res.ok ? "Saved." : "Failed to save.");
  }

  return (
    <AdminShell active="/admin/settings">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">Settings</h2>
        <p className="text-muted text-sm mt-1">
          Programme dates, fees, payment details, and contact info. These feed the {"{{token}}"} variables
          used in your email templates.
        </p>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="border border-border rounded-xl p-6 space-y-5 max-w-2xl">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <label className="block text-xs uppercase tracking-wider text-muted mb-2">
                {field.label}
              </label>
              <input
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                className="w-full bg-black/30 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold"
              />
              {field.hint && <p className="text-xs text-muted mt-1.5">{field.hint}</p>}
            </div>
          ))}

          <div className="flex items-center gap-4 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Settings"}
            </button>
            {message && <span className="text-sm text-muted">{message}</span>}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
