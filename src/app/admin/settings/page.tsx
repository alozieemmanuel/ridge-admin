"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { useIsOwner } from "@/lib/useIsOwner";
import ThemeToggle from "@/components/ThemeToggle";

const FIELDS: { key: string; label: string; hint?: string; placeholder?: string }[] = [
  { key: "programme_name", label: "Event name", hint: "Shown on invitations, tickets and the reserve page." },
  { key: "event_caption", label: "Tagline", hint: "The small line above the event name, e.g. “By invitation only”." },
  { key: "event_date", label: "Date", placeholder: "Saturday 14th November, 2026", hint: "Required before any invitation can be sent." },
  { key: "event_time", label: "Time", placeholder: "9:00 AM" },
  { key: "event_venue", label: "Venue", placeholder: "Name and address of the venue", hint: "Required before any invitation can be sent." },
  { key: "seat_capacity", label: "Number of seats", hint: "Reservations stop when this many seats are taken. You can also change it on the Attendance page. Leave empty for no limit." },
  { key: "contact_email", label: "Contact email", hint: "Where guests are told to send questions. Replies to your emails go here." },
  { key: "contact_phone", label: "Contact phone", hint: "Shown on the reserve page and in the ticket email." },
  { key: "sender_name", label: "Email sender name" },
  {
    key: "notification_email",
    label: "Internal notification email",
    hint: "Optional. Where team alerts are sent. Leave empty to switch them off.",
  },
];

type ClearTarget = "registrations" | "brochure_requests" | "all";

const CLEAR_OPTIONS: { value: ClearTarget; label: string }[] = [{ value: "registrations", label: "The whole guest list" }];

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
        const { registrations = 0 } = data.deleted ?? {};
        setResult({ text: `Deleted ${registrations} guest${registrations === 1 ? "" : "s"}.`, ok: true });
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
        Permanently delete the guest list, including their notes, reservations and tickets. This can&apos;t be undone and affects what every
        admin sees. Export the CSV from the Registrations page first. Settings, email templates and admin accounts are not touched.
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
          className="bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-red-400"
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
        <h2 className="font-serif text-3xl">Settings</h2>
        <p className="text-muted text-sm mt-1.5">
          The event details used on invitations, tickets and the reserve page. Each one is also available in your email templates as a {"{{token}}"}, for example {"{{event_date}}"}.
        </p>
      </div>

      <div className="border border-border rounded-xl p-6 mb-8 max-w-2xl">
        <h3 className="font-serif text-xl mb-1">Appearance</h3>
        <p className="text-sm text-muted mb-4">Choose how the dashboard looks. This is saved on this device only.</p>
        <ThemeToggle />
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="border border-border rounded-xl p-6 space-y-5 max-w-2xl">
          <h3 className="font-serif text-xl -mb-1">Event details</h3>
          {FIELDS.map((field) => (
            <div key={field.key}>
              <label className="block text-xs uppercase tracking-wider text-muted mb-2">
                {field.label}
              </label>
              <input
                value={values[field.key] ?? ""}
                placeholder={field.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                className="w-full bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold"
              />
              {field.hint && <p className="text-xs text-muted mt-1.5">{field.hint}</p>}
            </div>
          ))}

          <div className="flex items-center gap-4 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-[#141C08] font-semibold uppercase tracking-widest disabled:opacity-60"
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
