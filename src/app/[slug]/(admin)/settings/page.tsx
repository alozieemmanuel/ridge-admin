"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEvent, useEventPath } from "@/lib/useEvent";
import { EVENT_MODULES } from "@/lib/eventModules";
import EventBrandFields, { emptyLogo, type BrandDraft } from "@/components/EventBrandFields";
import { removeLogo, uploadLogo } from "@/lib/brandClient";
import { DEFAULT_COLOR, EVENT_TYPES, TIMEZONES, termsOf } from "@/lib/eventTheme";
import DataSourcePanel from "@/components/DataSourcePanel";
import PaymentsPanel from "@/components/PaymentsPanel";
import AdminShell from "@/components/AdminShell";
import { useIsOwner } from "@/lib/useIsOwner";
import ThemeToggle from "@/components/ThemeToggle";
import TemplatesPanel from "@/components/TemplatesPanel";
import { cacheDeletePrefix } from "@/lib/clientCache";

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

type ClearTarget = "registrations" | "everything";

const CLEAR_OPTIONS: { value: ClearTarget; label: string; hint: string }[] = [
  { value: "everything", label: "Everything in this event", hint: "The contacts plus this event's campaigns and activity log. Its settings and email templates stay. Other events are not touched." },
  { value: "registrations", label: "Only the contacts", hint: "Contacts with their follow-up logs and tickets. Campaigns and the activity log are kept." },
];

/** Owner-only: permanently wipe records (e.g. test data before launch). */
function DangerZone() {
  const [target, setTarget] = useState<ClearTarget>("everything");
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
        for (const prefix of ["/api/admin/registrations", "/api/admin/overview", "/api/admin/attendance", "/api/admin/campaigns", "/api/admin/audit-logs"]) cacheDeletePrefix(prefix);
        setResult({ text: `Done. Deleted ${registrations} guest${registrations === 1 ? "" : "s"}${target === "everything" ? " and the event's campaigns and activity" : ""}.`, ok: true });
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
    <div className="border border-red-400/40 rounded-xl p-6 max-w-2xl">
      <h3 className="text-red-400 text-sm font-semibold mb-1">Danger zone</h3>
      <p className="text-sm text-muted mb-4">
        Permanently delete data of this event only. This can&apos;t be undone and affects what every admin sees. Export the CSV from the Contacts page first.
        Admin accounts, the event details and the email templates are not touched.
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
      <p className="text-xs text-muted mb-4">{CLEAR_OPTIONS.find((o) => o.value === target)?.hint}</p>

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

/** Owner-only: the event's name, colour, logos and the words it uses. */
function BrandingPanel() {
  const { event } = useEvent();
  const [draft, setDraft] = useState<BrandDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (event && !draft) {
      setDraft({
        brandName: event.brandName ?? "",
        color: event.color ?? DEFAULT_COLOR,
        logo: emptyLogo(event.logoUrl),
        logoDark: emptyLogo(event.logoDarkUrl),
        terms: termsOf(event.terms),
      });
    }
  }, [event, draft]);

  if (!event || !draft) return <p className="text-muted">Loading…</p>;

  async function save() {
    if (!event || !draft) return;
    setBusy(true);
    setMessage(null);
    const body: Record<string, unknown> = { brandName: draft.brandName, color: draft.color, terms: draft.terms };
    const link = draft.logo.link.trim();
    const linkDark = draft.logoDark.link.trim();
    if (link) body.logoUrl = link;
    if (linkDark) body.logoDarkUrl = linkDark;
    const res = await fetch("/api/admin/event", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setBusy(false);
      return setMessage({ text: json.error || "Couldn't save.", ok: false });
    }
    let problem: string | null = null;
    for (const [variant, d] of [["light", draft.logo], ["dark", draft.logoDark]] as const) {
      if (d.file) problem = (await uploadLogo(event.slug, variant, d.file)) ?? problem;
      else if (d.removed && !d.link.trim()) await removeLogo(event.slug, variant);
    }
    setBusy(false);
    if (problem) return setMessage({ text: problem, ok: false });
    cacheDeletePrefix("/api/admin/event");
    cacheDeletePrefix("/api/events");
    window.location.reload();
  }

  return (
    <div className="border border-border rounded-xl p-6 max-w-3xl">
      <h3 className="font-serif text-xl mb-1">Branding and wording</h3>
      <p className="text-sm text-muted mb-6">How this event looks to your team and to guests, and what it calls its people.</p>
      <EventBrandFields value={draft} onChange={setDraft} fallbackName={event.name} />
      <div className="flex items-center gap-3 flex-wrap mt-8">
        <button onClick={save} disabled={busy} className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-[#141C08] font-semibold uppercase tracking-widest disabled:opacity-50">
          {busy ? "Saving…" : "Save branding"}
        </button>
        {message && <span className={`text-sm ${message.ok ? "text-muted" : "text-red-400"}`}>{message.text}</span>}
      </div>
    </div>
  );
}

/** Owner-only: which parts this event uses, and archiving it. */
function EventPanel() {
  const { event } = useEvent();
  const router = useRouter();
  const [modules, setModules] = useState<string[] | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const current = modules ?? event?.modules ?? [];

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/event", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) return setMessage({ text: json.error || "Couldn't save.", ok: false });
    cacheDeletePrefix("/api/admin/event");
    setMessage({ text: done, ok: true });
    // The sidebar reads the event again.
    window.location.reload();
  }

  if (!event) return null;
  return (
    <div className="border border-border rounded-xl p-6 max-w-2xl mb-6">
      <h3 className="font-serif text-xl mb-1">Edit this event</h3>
      <p className="text-sm text-muted mb-5">Change the name, the kind of event and which parts it uses. The address of the event stays the same.</p>
      <div className="grid sm:grid-cols-2 gap-5 mb-6">
        <div>
          <label htmlFor="ev-name" className="block text-sm font-medium mb-1.5">
            Event name
          </label>
          <input id="ev-name" value={name ?? event.name} onChange={(e) => setName(e.target.value)} maxLength={120} className="w-full bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold" />
        </div>
        <div>
          <label htmlFor="ev-type" className="block text-sm font-medium mb-1.5">
            Kind of event
          </label>
          <select id="ev-type" value={type ?? event.type} onChange={(e) => setType(e.target.value)} className="w-full bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold">
            {EVENT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {(type ?? event.type) === "paid" && event.type !== "paid" && <p className="text-xs text-muted mt-1.5">A Payments tab will appear after you save.</p>}
        </div>
      </div>
      <p className="text-sm font-medium mb-2">Parts of this event</p>
      <p className="text-xs text-muted mb-3">Contacts, the contact source and settings are always on. Switch the rest on or off.</p>
      <div className="space-y-3 mb-4">
        {EVENT_MODULES.map((m) => (
          <label key={m.key} className="flex items-start gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 accent-gold"
              checked={current.includes(m.key)}
              onChange={(e) => setModules(e.target.checked ? [...current, m.key] : current.filter((x) => x !== m.key))}
            />
            <span>
              <span className="font-medium">{m.label}</span>
              <span className="block text-xs text-muted">{m.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mb-5">
        <label htmlFor="tz" className="block text-sm font-medium mb-1.5">
          Time zone
        </label>
        <select id="tz" value={timezone ?? event.timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full max-w-xs bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold">
          {TIMEZONES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button disabled={busy || (modules === null && timezone === null && name === null && type === null)} onClick={() => patch({ modules: current, timezone: timezone ?? event.timezone, name: name ?? event.name, type: type ?? event.type }, "Saved.")} className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-[#141C08] font-semibold uppercase tracking-widest disabled:opacity-50">
          Save
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (event.status === "ACTIVE" && !window.confirm("Archive this event? It moves out of the active list. Nothing is deleted and you can restore it.")) return;
            patch({ status: event.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" }, "Done.").then(() => router.refresh());
          }}
          className="text-sm px-4 py-2.5 rounded-full border border-border hover:border-gold transition-colors disabled:opacity-50"
        >
          {event.status === "ACTIVE" ? "Archive event" : event.status === "DRAFT" ? "Publish event" : "Restore event"}
        </button>
        {message && <span className={`text-sm ${message.ok ? "text-muted" : "text-red-400"}`}>{message.text}</span>}
      </div>
    </div>
  );
}

function SettingsInner() {
  const ep = useEventPath();
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isOwner = useIsOwner();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("tab");
  const tab = requested === "templates" || requested === "appearance" || ((requested === "data" || requested === "branding" || requested === "source" || requested === "payments") && isOwner) ? requested : "event";

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

  const { event } = useEvent();
  const TABS = [
    { id: "event", label: "Event details" },
    { id: "templates", label: "Email templates" },
    { id: "appearance", label: "Appearance" },
    ...(isOwner
      ? [
          { id: "branding", label: "Branding" },
          { id: "source", label: "Contacts source" },
          ...(event?.type === "paid" ? [{ id: "payments", label: "Payments" }] : []),
          { id: "data", label: "Edit event" },
        ]
      : []),
  ];

  return (
    <AdminShell>
      <div className="mb-6">
        <h2 className="font-serif text-3xl">Settings</h2>
        <p className="text-muted text-sm mt-1.5">The event details, the emails guests receive, how the dashboard looks, and data tools.</p>
      </div>

      <div className="flex gap-2 flex-wrap mb-8 border-b border-border pb-4" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => router.replace(t.id === "event" ? ep("/settings") : ep(`/settings?tab=${t.id}`), { scroll: false })}
            className={`text-sm px-4 py-2 rounded-full border transition-colors ${tab === t.id ? "border-gold bg-gold/15 font-medium" : "border-border text-muted hover:text-fg hover:border-gold/60"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "appearance" && (
        <div className="border border-border rounded-xl p-6 max-w-2xl">
          <h3 className="font-serif text-xl mb-1">Appearance</h3>
          <p className="text-sm text-muted mb-4">Choose how the dashboard looks. This is saved on this device only.</p>
          <ThemeToggle />
        </div>
      )}

      {tab === "templates" && <TemplatesPanel />}

      {tab === "branding" && isOwner && <BrandingPanel />}

      {tab === "source" && isOwner && <DataSourcePanel />}

      {tab === "payments" && isOwner && event?.type === "paid" && <PaymentsPanel />}

      {tab === "data" && isOwner && (
        <>
          <EventPanel />
          <DangerZone />
        </>
      )}

      {tab === "event" &&
        (loading ? (
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
        ))}
    </AdminShell>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsInner />
    </Suspense>
  );
}
