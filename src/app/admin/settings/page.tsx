"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { useIsOwner } from "@/lib/useIsOwner";

const FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "programme_name", label: "Programme Name" },
  { key: "event_caption", label: "Event Caption" },
  { key: "cohort_dates", label: "Cohort Dates" },
  { key: "sender_name", label: "Email Sender Name" },
  { key: "registration_fee", label: "Early Bird Fee (display text)" },
  { key: "late_registration_fee", label: "Late Fee (display text)" },
  {
    key: "registration_fee_amount",
    label: "Early Bird Fee Amount (number)",
    hint: "Plain number, no currency symbol — used to auto-calculate paid/partial/not paid on the Payments page.",
  },
  {
    key: "late_registration_fee_amount",
    label: "Late Fee Amount (number)",
    hint: "Plain number, no currency symbol — used to auto-calculate paid/partial/not paid on the Payments page.",
  },
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
    hint: "Where the built-in new-registration and new-brochure-request alerts are sent. Leave empty to switch them off.",
  },
  { key: "contact_whatsapp_number", label: "WhatsApp Number", hint: "Digits only, country code, no plus sign." },
  { key: "contact_whatsapp_message", label: "WhatsApp Pre-filled Message" },
];

type ClearTarget = "registrations" | "brochure_requests" | "all";

const CLEAR_OPTIONS: { value: ClearTarget; label: string }[] = [
  { value: "registrations", label: "Registrations" },
  { value: "brochure_requests", label: "Brochure requests" },
  { value: "all", label: "Both" },
];

/** Owner-only: permanently wipe records (e.g. test data before launch). */
function DangerZone() {
  const [target, setTarget] = useState<ClearTarget>("registrations");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleClear() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/data/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, confirm: confirmText }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const { registrations = 0, brochureRequests = 0 } = data.deleted ?? {};
        setResult({
          text: `Deleted ${registrations} registration${registrations === 1 ? "" : "s"} and ${brochureRequests} brochure request${
            brochureRequests === 1 ? "" : "s"
          }.`,
          ok: true,
        });
        setConfirmText("");
      } else {
        setResult({ text: data.error || "Failed to clear data.", ok: false });
      }
    } catch {
      setResult({ text: "Couldn't reach the server. Try again.", ok: false });
    }
    setBusy(false);
  }

  return (
    <div className="border border-red-400/40 rounded-xl p-6 mt-8 max-w-2xl">
      <h3 className="text-red-400 text-sm font-semibold mb-1">Danger zone</h3>
      <p className="text-sm text-muted mb-4">
        Permanently delete records — for example test data before launch. This can&apos;t be undone and affects what every
        admin sees, including real sign-ups. Export the CSV from the Registrations page first. Settings, email templates
        and admin accounts are not touched, and seats held by deleted registrations are released.
      </p>

      <div className="flex gap-2 flex-wrap mb-4">
        {CLEAR_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => setTarget(o.value)}
            className={`text-sm px-4 py-2 rounded-full border transition-colors whitespace-nowrap ${
              target === o.value ? "border-red-400 text-red-300 bg-red-500/10" : "border-border text-muted"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <label className="block text-xs uppercase tracking-wider text-muted mb-2">Type DELETE to confirm</label>
      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          className="bg-black/30 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-red-400"
        />
        <button
          onClick={handleClear}
          disabled={busy || confirmText !== "DELETE"}
          className="text-sm px-5 py-2.5 rounded-full bg-red-500/90 text-white font-semibold uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Deleting…" : "Delete permanently"}
        </button>
      </div>
      {result && <p className={`text-sm mt-3 ${result.ok ? "text-emerald-400" : "text-red-400"}`}>{result.text}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isOwner = useIsOwner();

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

      {isOwner && <DangerZone />}
    </AdminShell>
  );
}
