"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import EventBrandFields, { emptyLogo, useLogoPreview, type BrandDraft } from "@/components/EventBrandFields";
import EventCard from "@/components/EventCard";
import { ghostButton, inputClass, primaryButton } from "@/components/ui";
import { EVENT_MODULES } from "@/lib/eventModules";
import { DATA_SOURCES, type DataSourceId } from "@/lib/dataSources";
import { PaymentFields } from "@/components/PaymentsPanel";
import { formatPrice, paymentProblem, type PaymentConfig, PAY_METHODS } from "@/lib/payments";
import { BASE_PATH, RESERVED_SLUGS } from "@/lib/basePath";
import { cacheDeletePrefix } from "@/lib/clientCache";
import { uploadLogo } from "@/lib/brandClient";
import { DEFAULT_COLOR, EVENT_TYPES, SYNC_INTERVALS, TIMEZONES, eventType, onColor, themeStyle } from "@/lib/eventTheme";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function slugProblem(slug: string): string | null {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 2) return "Use letters, numbers and single dashes, for example investor-hangout.";
  if (RESERVED_SLUGS.includes(slug)) return `"${slug}" is used by the dashboard itself. Choose another address.`;
  return null;
}

interface Draft {
  type: string;
  copyFrom: string;
  name: string;
  slug: string;
  slugEdited: boolean;
  timezone: string;
  date: string;
  time: string;
  online: boolean;
  venue: string;
  capacity: string;
  tagline: string;
  brand: BrandDraft;
  source: DataSourceId;
  sb: { url: string; table: string; key: string };
  payment: PaymentConfig;
  sheetUrl: string;
  sheetInterval: number;
  modules: string[];
  senderName: string;
  contactEmail: string;
  contactPhone: string;
  adminIds: string[];
  publish: boolean;
}

interface AdminOption {
  id: string;
  name: string;
  email: string;
  role?: string;
  archivedAt?: string | null;
}
interface EventOption {
  id: string;
  name: string;
}

const ALL_STEPS = ["Basics", "Brand", "Wording", "Contacts", "Features", "Payments", "Team", "Review"] as const;

const label = "block text-sm font-medium mb-1.5";
const hint = "text-xs text-muted mt-1.5";

function Heading({ title, text }: { title: string; text: string }) {
  return (
    <div className="mb-7">
      <h2 className="font-serif text-2xl">{title}</h2>
      <p className="text-muted text-sm mt-1.5 max-w-xl">{text}</p>
    </div>
  );
}

function Switch({ on, onChange, title, text, disabled }: { on: boolean; onChange: (v: boolean) => void; title: string; text: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-4 rounded-xl border p-4 ${disabled ? "opacity-60" : "cursor-pointer"} ${on ? "border-gold bg-gold/5" : "border-border"}`}>
      <input type="checkbox" className="sr-only peer" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className={`mt-0.5 h-6 w-11 rounded-full p-0.5 shrink-0 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-gold ${on ? "bg-gold" : "bg-border"}`}>
        <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-sm">{title}</span>
        <span className="block text-xs text-muted mt-0.5">{text}</span>
      </span>
    </label>
  );
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex gap-4 py-2.5 border-b border-border/60 last:border-b-0 text-sm">
      <dt className="w-40 shrink-0 text-muted">{name}</dt>
      <dd className="min-w-0 break-words">{value || <span className="text-muted">Not set</span>}</dd>
    </div>
  );
}

/** Owner only: create an event in seven short steps, with a live preview of how it will look. */
export default function NewEventPage() {
  const router = useRouter();
  const first = EVENT_TYPES[0];
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [draft, setDraft] = useState<Draft>({
    type: first.id,
    copyFrom: "",
    name: "",
    slug: "",
    slugEdited: false,
    timezone: "Africa/Lagos",
    date: "",
    time: "",
    online: false,
    venue: "",
    capacity: "",
    tagline: "",
    brand: { brandName: "", color: DEFAULT_COLOR, logo: emptyLogo(), logoDark: emptyLogo(), terms: { ...first.terms, action: "Reserve my seat" } },
    source: "manual",
    sb: { url: "", table: "", key: "" },
    payment: { price: "", currency: "NGN", method: "bank", details: "" },
    sheetUrl: "",
    sheetInterval: 5,
    modules: first.modules,
    senderName: "",
    contactEmail: "",
    contactPhone: "",
    adminIds: [],
    publish: true,
  });
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/admins")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAdmins((d.admins as AdminOption[]).filter((a) => a.role === "ADMIN" && !a.archivedAt)))
      .catch(() => undefined);
    fetch("/api/events")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setEvents(d.events.map((e: EventOption) => ({ id: e.id, name: e.name }))))
      .catch(() => undefined);
  }, []);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const type = eventType(draft.type);
  // The Payments step only exists for paid events.
  const STEPS = ALL_STEPS.filter((x) => x !== "Payments" || type.paid);
  const name = STEPS[step] ?? STEPS[0];
  const seats = draft.modules.includes("invitations");
  const problem = draft.slug ? slugProblem(draft.slug) : null;

  function pickType(id: string) {
    const t = eventType(id);
    setDraft((d) => ({ ...d, type: id, modules: t.modules, online: Boolean(t.online), brand: { ...d.brand, terms: { ...d.brand.terms, person: t.terms.person, people: t.terms.people } } }));
  }

  const stepProblem = (i: number): string | null => {
    const n = STEPS[i];
    if (n === "Basics") {
      if (draft.name.trim().length < 2) return "Give the event a name.";
      if (!draft.slug || problem) return problem ?? "Choose a web address.";
    }
    if (n === "Contacts") {
      if (draft.source === "sheet" && !/^https:\/\//.test(draft.sheetUrl.trim())) return "Paste the sheet link, or choose another way to add contacts.";
      if (draft.source === "supabase") {
        if (!/^https:\/\/[^\s/]+\.[^\s/]+/.test(draft.sb.url.trim())) return "Enter the Supabase project address, like https://abcd.supabase.co.";
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(draft.sb.table.trim())) return "Enter the table name. Letters, numbers and underscores only.";
        if (draft.sb.key.trim().length < 20) return "Paste the Supabase API key.";
      }
    }
    if (n === "Payments") return paymentProblem(draft.payment);
    return null;
  };
  const blocked = stepProblem(step);

  function go(i: number) {
    if (i > step && i > reached + 0 && stepProblem(step)) return;
    setError(null);
    setStep(i);
    setReached((r) => Math.max(r, i));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function create() {
    for (let i = 0; i < STEPS.length - 1; i++) {
      const p = stepProblem(i);
      if (p) {
        setError(p);
        setStep(i);
        return;
      }
    }
    setBusy(true);
    setError(null);
    const b = draft.brand;
    const body = {
      name: draft.name.trim(),
      slug: draft.slug,
      type: draft.type,
      status: draft.publish ? "ACTIVE" : "DRAFT",
      modules: draft.modules,
      brandName: b.brandName,
      color: b.color === DEFAULT_COLOR ? null : b.color,
      logoUrl: b.logo.link.trim() || undefined,
      logoDarkUrl: b.logoDark.link.trim() || undefined,
      terms: b.terms,
      timezone: draft.timezone,
      tagline: draft.tagline,
      date: draft.date,
      time: draft.time,
      venue: draft.venue,
      capacity: seats ? draft.capacity : undefined,
      contactEmail: draft.contactEmail,
      contactPhone: draft.contactPhone,
      senderName: draft.senderName,
      sheetUrl: draft.source === "sheet" ? draft.sheetUrl.trim() : "",
      dataSource: draft.source,
      supabase: draft.source === "supabase" ? draft.sb : undefined,
      payment: type.paid ? draft.payment : undefined,
      sheetInterval: draft.sheetInterval,
      copyFrom: draft.copyFrom || undefined,
      adminIds: draft.adminIds,
    };
    const res = await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setBusy(false);
      setError(json.error || "Couldn't create the event. Check your connection and try again.");
      if (res?.status === 409 || res?.status === 400) setStep(0);
      return;
    }
    const slug: string = json.event.slug;
    let warning = "";
    for (const [variant, d] of [["light", b.logo], ["dark", b.logoDark]] as const) {
      if (d.file) warning = (await uploadLogo(slug, variant, d.file)) ?? warning;
    }
    cacheDeletePrefix("/api/events");
    // A failed logo upload does not undo the event. It can be added again in Settings, Branding.
    router.push(warning ? `/${slug}/settings?tab=branding` : `/${slug}/contacts`);
  }

  const theme = themeStyle(draft.brand.color);
  const logoPreview = useLogoPreview(draft.brand.logo);
  const previewEvent = useMemo(
    () => ({
      slug: draft.slug || "your-event",
      name: draft.name.trim() || "Your event name",
      brandName: draft.brand.brandName,
      color: draft.brand.color,
      logoUrl: logoPreview,
      type: draft.type,
      status: (draft.publish ? "ACTIVE" : "DRAFT") as "ACTIVE" | "DRAFT",
      modules: draft.modules,
      terms: draft.brand.terms,
      tagline: draft.tagline,
      date: draft.date,
      time: draft.time,
      venue: draft.online ? "Online" : draft.venue,
      total: 0,
      reserved: 0,
      checkedIn: 0,
      contacted: 0,
      capacity: draft.capacity ? parseInt(draft.capacity, 10) || null : null,
    }),
    [draft, logoPreview]
  );

  const stepper = (
    <ol className="flex flex-wrap gap-x-1 gap-y-2 mb-8" aria-label="Steps">
      {STEPS.map((s, i) => {
        const done = i < step || (i <= reached && i !== step);
        const current = i === step;
        return (
          <li key={s}>
            <button
              type="button"
              onClick={() => (i <= reached ? go(i) : undefined)}
              disabled={i > reached}
              aria-current={current ? "step" : undefined}
              className={`flex items-center gap-2 text-sm rounded-full pl-1.5 pr-3.5 py-1.5 transition-colors ${current ? "bg-gold/15 font-medium" : "text-muted"} ${i <= reached && !current ? "hover:text-fg" : ""} disabled:cursor-default`}
            >
              <span className={`h-6 w-6 rounded-full grid place-items-center text-xs ${current ? "bg-gold" : done ? "border border-gold" : "border border-border"}`} style={current ? { color: onColor(draft.brand.color) } : undefined}>
                {done && !current ? "✓" : i + 1}
              </span>
              {s}
            </button>
          </li>
        );
      })}
    </ol>
  );

  return (
    <AdminShell>
      <div className={theme ? "event-themed" : ""} style={theme}>
        <div className="mb-6">
          <Link href="/" className="text-sm text-muted hover:text-fg">
            ← All events
          </Link>
          <h1 className="font-serif text-4xl mt-3">New event</h1>
        </div>
        {stepper}

        <div className="grid xl:grid-cols-[minmax(0,40rem)_minmax(0,22rem)] gap-12 items-start">
          <div>
            {name === "Basics" && (
              <section>
                <Heading title="What kind of event is it?" text="This only sets sensible defaults. You can change everything later." />
                <div className="grid sm:grid-cols-2 gap-3 mb-8" role="radiogroup" aria-label="Event type">
                  {EVENT_TYPES.map((t) => (
                    <button key={t.id} type="button" role="radio" aria-checked={draft.type === t.id} onClick={() => pickType(t.id)} className={`text-left rounded-xl border p-4 transition-colors ${draft.type === t.id ? "border-gold bg-gold/10" : "border-border hover:border-gold/60"}`}>
                      <span className="block font-medium text-sm">{t.label}</span>
                      <span className="block text-xs text-muted mt-1">{t.hint}</span>
                    </button>
                  ))}
                </div>

                <div className="space-y-6">
                  <div>
                    <label htmlFor="ev-name" className={label}>
                      Event name
                    </label>
                    <input
                      id="ev-name"
                      value={draft.name}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value, slug: d.slugEdited ? d.slug : slugify(e.target.value) }))}
                      placeholder="e.g. Sales Pro Conference 2026"
                      className={inputClass}
                      maxLength={120}
                    />
                  </div>
                  <div>
                    <label htmlFor="ev-slug" className={label}>
                      Web address
                    </label>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted whitespace-nowrap">{`${BASE_PATH}/`}</span>
                      <input id="ev-slug" value={draft.slug} onChange={(e) => set({ slug: slugify(e.target.value), slugEdited: true })} className={inputClass} />
                    </div>
                    {problem ? <p className="text-xs text-red-400 mt-1.5">{problem}</p> : <p className={hint}>Guests&apos; own links use this address. It can&apos;t be changed later.</p>}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                      <label htmlFor="ev-date" className={label}>
                        Date
                      </label>
                      <input id="ev-date" value={draft.date} onChange={(e) => set({ date: e.target.value })} placeholder="Saturday 14th November, 2026" className={inputClass} />
                    </div>
                    <div>
                      <label htmlFor="ev-time" className={label}>
                        Time
                      </label>
                      <input id="ev-time" value={draft.time} onChange={(e) => set({ time: e.target.value })} placeholder="9:00 AM" className={inputClass} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-4 mb-1.5">
                      <label htmlFor="ev-venue" className="text-sm font-medium">
                        {draft.online ? "Meeting link" : "Venue"}
                      </label>
                      <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                        <input type="checkbox" className="accent-gold" checked={draft.online} onChange={(e) => set({ online: e.target.checked })} />
                        This event is online
                      </label>
                    </div>
                    <input id="ev-venue" value={draft.venue} onChange={(e) => set({ venue: e.target.value })} placeholder={draft.online ? "https://…" : "Name and address of the venue"} className={inputClass} />
                    <p className={hint}>Required before invitations can be sent. You can add it later.</p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-5">
                    {seats && (
                      <div>
                        <label htmlFor="ev-cap" className={label}>
                          Number of seats
                        </label>
                        <input id="ev-cap" inputMode="numeric" value={draft.capacity} onChange={(e) => set({ capacity: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="No limit" className={inputClass} />
                      </div>
                    )}
                    <div>
                      <label htmlFor="ev-tz" className={label}>
                        Time zone
                      </label>
                      <select id="ev-tz" value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} className={inputClass}>
                        {TIMEZONES.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {events.length > 0 && (
                    <div>
                      <label htmlFor="ev-copy" className={label}>
                        Start from another event (optional)
                      </label>
                      <select id="ev-copy" value={draft.copyFrom} onChange={(e) => set({ copyFrom: e.target.value })} className={inputClass}>
                        <option value="">No, start fresh</option>
                        {events.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                      <p className={hint}>Copies its email wording and contact details. Contacts, dates and seat limit are not copied.</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {name === "Brand" && (
              <section>
                <Heading title="Give it a look" text="Most events have their own name and logo. The colour tells your team which event they are in." />
                <div className="mb-7">
                  <label htmlFor="ev-tag" className={label}>
                    Tagline (optional)
                  </label>
                  <input id="ev-tag" value={draft.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="e.g. By invitation only" className={inputClass} maxLength={120} />
                  <p className={hint}>The small line above the event name on the guest page and in emails.</p>
                </div>
                <EventBrandFields section="brand" value={draft.brand} onChange={(brand) => set({ brand })} fallbackName={draft.name} />
              </section>
            )}

            {name === "Wording" && (
              <section>
                <Heading title="Choose your words" text="Pick what this event calls its people. The menus and headings follow it, so Sales Pro can say Registrations while another event says Contacts." />
                <EventBrandFields section="wording" value={draft.brand} onChange={(brand) => set({ brand })} fallbackName={draft.name} />
              </section>
            )}

            {name === "Contacts" && (
              <section>
                <Heading title={`Where do your ${draft.brand.terms.people.toLowerCase()} come from?`} text="You can change this at any time in Settings, Contacts source." />
                <div className="grid sm:grid-cols-2 gap-3 mb-7" role="radiogroup" aria-label="Where contacts come from">
                  {DATA_SOURCES.map((d) => (
                    <button key={d.id} type="button" role="radio" aria-checked={draft.source === d.id} onClick={() => set({ source: d.id })} className={`text-left rounded-xl border p-4 ${draft.source === d.id ? "border-gold bg-gold/10" : "border-border hover:border-gold/60"}`}>
                      <span className="block font-medium text-sm">{d.label}</span>
                      <span className="block text-xs text-muted mt-1">{d.hint}</span>
                    </button>
                  ))}
                </div>
                {draft.source === "sheet" && (
                  <div className="space-y-5 mb-7">
                    <div>
                      <label htmlFor="ev-sheet" className={label}>
                        Sheet link
                      </label>
                      <input id="ev-sheet" value={draft.sheetUrl} onChange={(e) => set({ sheetUrl: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/…" className={inputClass} />
                      <p className={hint}>In the sheet choose Share, then General access, then Anyone with the link as Viewer. The first row holds the column names, with at least a name and an email.</p>
                    </div>
                  </div>
                )}
                {draft.source === "supabase" && (
                  <div className="space-y-5 mb-7">
                    <div>
                      <label htmlFor="sb-url" className={label}>
                        Project address
                      </label>
                      <input id="sb-url" value={draft.sb.url} onChange={(e) => set({ sb: { ...draft.sb, url: e.target.value } })} placeholder="https://abcdefgh.supabase.co" className={inputClass} />
                      <p className={hint}>In Supabase: Project Settings, then API, then Project URL.</p>
                    </div>
                    <div>
                      <label htmlFor="sb-table" className={label}>
                        Table name
                      </label>
                      <input id="sb-table" value={draft.sb.table} onChange={(e) => set({ sb: { ...draft.sb, table: e.target.value } })} placeholder="registrations" className={inputClass} />
                      <p className={hint}>It needs a column for the email and one for the name, such as email and full_name.</p>
                    </div>
                    <div>
                      <label htmlFor="sb-key" className={label}>
                        API key
                      </label>
                      <input id="sb-key" type="password" autoComplete="off" value={draft.sb.key} onChange={(e) => set({ sb: { ...draft.sb, key: e.target.value } })} className={inputClass} />
                      <p className={hint}>Stored on the server and never shown again. The service_role key can read every table, so keep it private.</p>
                    </div>
                  </div>
                )}
                {(draft.source === "sheet" || draft.source === "supabase") && (
                  <div className="mb-7">
                    <label htmlFor="ev-int" className={label}>
                      How often should the dashboard check it?
                    </label>
                    <select id="ev-int" value={draft.sheetInterval} onChange={(e) => set({ sheetInterval: Number(e.target.value) })} className={inputClass}>
                      {SYNC_INTERVALS.map((s) => (
                        <option key={s.minutes} value={s.minutes}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <p className={hint}>Checking happens on the server, so new registrations arrive even when nobody has the dashboard open. Nobody is emailed by it.</p>
                  </div>
                )}
                {draft.source === "form" && <p className="text-sm text-muted mb-7">After you create the event, Settings, Contacts source shows the secret address and a ready-made form to paste into your website.</p>}
                {draft.source === "manual" && <p className="text-sm text-muted mb-7">Upload a CSV file or use Add contact on the Contacts page.</p>}
              </section>
            )}

            {name === "Features" && (
              <section>
                <Heading title="What does this event need?" text={`${draft.brand.terms.people} and the live sheet are always on. Switch on only what you will use.`} />
                <div className="space-y-3 mb-8">
                  {EVENT_MODULES.map((m) => (
                    <Switch key={m.key} on={draft.modules.includes(m.key)} onChange={(v) => set({ modules: v ? [...draft.modules, m.key] : draft.modules.filter((x) => x !== m.key) })} title={m.label} text={m.hint} />
                  ))}
                </div>
                <h3 className="font-medium mb-4">Contact details guests will see</h3>
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label htmlFor="ev-sender" className={label}>
                      Email sender name
                    </label>
                    <input id="ev-sender" value={draft.senderName} onChange={(e) => set({ senderName: e.target.value })} placeholder={draft.brand.brandName || draft.name || "Event name"} className={inputClass} />
                  </div>
                  <div />
                  <div>
                    <label htmlFor="ev-ce" className={label}>
                      Contact email
                    </label>
                    <input id="ev-ce" type="email" value={draft.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} placeholder="events@yourcompany.com" className={inputClass} />
                    <p className={hint}>Replies to your emails go here.</p>
                  </div>
                  <div>
                    <label htmlFor="ev-cp" className={label}>
                      Contact phone
                    </label>
                    <input id="ev-cp" value={draft.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} className={inputClass} />
                  </div>
                </div>
              </section>
            )}

            {name === "Payments" && (
              <section>
                <Heading title="Ticket price" text="Guests see the price and how to pay on their page. You can change it later in Settings, Payments." />
                <PaymentFields value={draft.payment} onChange={(payment) => set({ payment })} />
              </section>
            )}

            {name === "Team" && (
              <section>
                <Heading title="Who can open it?" text="Owners can open every event. Choose which admins can open this one." />
                {admins.length === 0 ? (
                  <p className="text-sm text-muted">There are no other admins yet. You can add them later in Team.</p>
                ) : (
                  <div className="space-y-2">
                    {admins.map((a) => (
                      <label key={a.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 cursor-pointer text-sm">
                        <input type="checkbox" className="accent-gold" checked={draft.adminIds.includes(a.id)} onChange={(e) => set({ adminIds: e.target.checked ? [...draft.adminIds, a.id] : draft.adminIds.filter((x) => x !== a.id) })} />
                        <span className="font-medium">{a.name}</span>
                        <span className="text-muted truncate">{a.email}</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>
            )}

            {name === "Review" && (
              <section>
                <Heading title="Check and create" text="Everything here can be changed later in Settings." />
                <dl className="rounded-xl border border-border px-5 py-2 mb-6">
                  <Row name="Name" value={draft.name} />
                  <Row name="Address" value={`${BASE_PATH}/${draft.slug}`} />
                  <Row name="Type" value={type.label} />
                  <Row name="When" value={[draft.date, draft.time].filter(Boolean).join(", ")} />
                  <Row name={draft.online ? "Meeting link" : "Venue"} value={draft.venue} />
                  <Row name="Colour" value={draft.brand.color} />
                  <Row name="Logo" value={draft.brand.logo.file ? draft.brand.logo.file.name : draft.brand.logo.link ? "From a link" : ""} />
                  <Row name="People are called" value={`${draft.brand.terms.people}, button "${draft.brand.terms.action}"`} />
                  <Row name="Contacts from" value={DATA_SOURCES.find((d) => d.id === draft.source)?.label ?? ""} />
                  {type.paid && <Row name="Ticket" value={`${formatPrice(draft.payment.price, draft.payment.currency)}, ${PAY_METHODS.find((m) => m.id === draft.payment.method)?.label ?? ""}`} />}
                  <Row name="Uses" value={draft.modules.map((m) => EVENT_MODULES.find((x) => x.key === m)?.label.split(",")[0] ?? m).join(", ") || "Contacts only"} />
                  <Row name="Admins with access" value={draft.adminIds.length ? `${draft.adminIds.length} chosen, plus owners` : "Owners only"} />
                </dl>
                <div className="space-y-3">
                  <Switch on={draft.publish} onChange={(v) => set({ publish: v })} title={draft.publish ? "Publish now" : "Save as a draft"} text={draft.publish ? "The admins you chose can open it straight away." : "Only owners can see it until you publish it."} />
                </div>
              </section>
            )}

            {error && (
              <p role="alert" className="text-sm text-red-400 mt-6">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3 mt-9 pt-6 border-t border-border">
              {step > 0 && (
                <button type="button" onClick={() => go(step - 1)} className={ghostButton} disabled={busy}>
                  Back
                </button>
              )}
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    const p = stepProblem(step);
                    if (p) return setError(p);
                    go(step + 1);
                  }}
                  className={primaryButton}
                >
                  Continue
                </button>
              ) : (
                <button type="button" onClick={create} disabled={busy} className={primaryButton}>
                  {busy ? "Creating…" : draft.publish ? "Create event" : "Save draft"}
                </button>
              )}
              {name === "Brand" || name === "Wording" || name === "Contacts" ? <span className="text-xs text-muted">You can skip this and come back to it later.</span> : null}
            </div>
          </div>

          <aside className="xl:sticky xl:top-8" aria-label="Preview">
            <p className="text-sm font-medium mb-3">Preview</p>
            <EventCard event={previewEvent} preview />
            <div className="mt-5 rounded-2xl border border-border overflow-hidden bg-tint">
              <div className="bg-pagebg border-b border-border px-4 py-3 text-xs text-muted text-center truncate">{draft.brand.brandName || draft.name || "Your event"}</div>
              <div className="p-5 text-center">
                <p className="font-serif text-lg leading-snug">{draft.name || "Your event name"}</p>
                <p className="text-xs text-muted mt-1">You&apos;re invited, Ada.</p>
                <span className="inline-block mt-4 text-xs px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark font-semibold" style={{ color: onColor(draft.brand.color) }}>
                  {draft.brand.terms.action}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted mt-3">The guest page and the emails use the same colour.</p>
          </aside>
        </div>
      </div>
    </AdminShell>
  );
}
