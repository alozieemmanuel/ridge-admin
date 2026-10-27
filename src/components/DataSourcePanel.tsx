"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DATA_SOURCES, type DataSourceId } from "@/lib/dataSources";
import { SYNC_INTERVALS } from "@/lib/eventTheme";
import { useEventPath } from "@/lib/useEvent";
import { useIsTechnical } from "@/lib/useIsOwner";
import { cacheDeletePrefix } from "@/lib/clientCache";
import { formatDateTime, ghostButton, inputClass, primaryButton } from "@/components/ui";

interface LastSync {
  at: string;
  ok: boolean;
  error?: string;
  added?: number;
  updated?: number;
  rows?: number;
  problemCount?: number;
}
interface State {
  dataSource: DataSourceId;
  sheet: { url: string; interval: number; lastSync: LastSync | null };
  supabase: { url: string; table: string; hasKey: boolean; lastSync: LastSync | null };
  form: { endpoint: string; key: string; origins: string };
}

const label = "block text-sm font-medium mb-1.5";
const hint = "text-xs text-muted mt-1.5";

function Copy({ text, what }: { text: string; what: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={ghostButton}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      aria-label={`Copy ${what}`}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function SyncLine({ last }: { last: LastSync | null }) {
  if (!last) return <p className="text-xs text-muted">Not read yet.</p>;
  return last.ok ? (
    <p className="text-xs text-muted">
      Last read {formatDateTime(last.at)}: {last.added ?? 0} added, {last.updated ?? 0} updated{last.problemCount ? `, ${last.problemCount} rows skipped` : ""}.
    </p>
  ) : (
    <p className="text-xs text-red-400">Last read {formatDateTime(last.at)} failed: {last.error}</p>
  );
}

/** Owner only: where this event's contacts come from, and the settings for each way. */
export default function DataSourcePanel() {
  const tech = useIsTechnical();
  const ep = useEventPath();
  const [state, setState] = useState<State | null>(null);
  const [source, setSource] = useState<DataSourceId>("manual");
  const [sb, setSb] = useState({ url: "", table: "", key: "" });
  const [interval, setIntervalMinutes] = useState(5);
  const [origins, setOrigins] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  function apply(s: State) {
    setState(s);
    setSource(s.dataSource);
    setSb((v) => ({ url: s.supabase.url || v.url, table: s.supabase.table || v.table, key: "" }));
    setIntervalMinutes(s.sheet.interval);
    setOrigins(s.form.origins);
  }

  useEffect(() => {
    fetch("/api/admin/event/source", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && apply(s))
      .catch(() => setMessage({ text: "Could not load the settings.", ok: false }));
  }, []);

  async function call(method: "PUT" | "POST", body: object, name: string, done: string) {
    setBusy(name);
    setMessage(null);
    const res = await fetch("/api/admin/event/source", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res?.ok) return setMessage({ text: json.error || "That did not work.", ok: false });
    if (json.dataSource) apply(json);
    cacheDeletePrefix("/api/admin/event");
    cacheDeletePrefix("/api/events");
    cacheDeletePrefix("/api/admin/registrations");
    setMessage({ text: json.result === "synced" ? `Read ${json.rows ?? 0} rows: ${json.added ?? 0} added, ${json.updated ?? 0} updated.` : done, ok: true });
    return json;
  }

  if (!state) return <p className="text-muted">{message?.text ?? "Loading…"}</p>;

  const snippet = `<form method="POST" action="${state.form.endpoint}">
  <input type="hidden" name="key" value="${state.form.key}">
  <input name="name" placeholder="Full name" required>
  <input name="email" type="email" placeholder="Email" required>
  <input name="phone" placeholder="Phone">
  <input name="website" style="display:none" tabindex="-1" autocomplete="off">
  <button>Register</button>
</form>`;

  return (
    <div className="border border-border rounded-xl p-6 max-w-3xl">
      <h3 className="font-serif text-xl mb-1">Where contacts come from</h3>
      <p className="text-sm text-muted mb-6">Pick one. You can still add people by hand or import a CSV file whatever you choose.</p>

      <div className="grid sm:grid-cols-2 gap-3 mb-7" role="radiogroup" aria-label="Contact source">
        {DATA_SOURCES.map((d) => (
          <button key={d.id} type="button" role="radio" aria-checked={source === d.id} onClick={() => setSource(d.id)} className={`text-left rounded-xl border p-4 transition-colors ${source === d.id ? "border-gold bg-gold/10" : "border-border hover:border-gold/60"}`}>
            <span className="block font-medium text-sm">{d.label}</span>
            <span className="block text-xs text-muted mt-1">{d.hint}</span>
          </button>
        ))}
      </div>

      {source === "sheet" && (
        <div className="mb-7 text-sm">
          {state.sheet.url ? (
            <>
              <p className="mb-2">
                Linked sheet: <span className="text-muted break-all">{state.sheet.url}</span>
              </p>
              <SyncLine last={state.sheet.lastSync} />
            </>
          ) : (
            <p className="text-muted">No sheet is linked yet.</p>
          )}
          <p className="mt-3 text-muted">
            Paste or change the link on the <Link href={ep("/contacts")} className="underline text-fg">Contacts page</Link>, under Live sheet.
          </p>
        </div>
      )}

      {(source === "supabase" || source === "form") && !tech && (
        <p className="text-sm text-muted mb-7">The connection details for this source (keys and private addresses) are looked after by the owner. Contacts from it appear in the dashboard as usual.</p>
      )}

      {source === "supabase" && tech && (
        <div className="space-y-5 mb-7">
          <div>
            <label htmlFor="sb-url" className={label}>
              Project address
            </label>
            <input id="sb-url" value={sb.url} onChange={(e) => setSb({ ...sb, url: e.target.value })} placeholder="https://abcdefgh.supabase.co" className={inputClass} />
            <p className={hint}>In Supabase: Project Settings, then API, then Project URL.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label htmlFor="sb-table" className={label}>
                Table name
              </label>
              <input id="sb-table" value={sb.table} onChange={(e) => setSb({ ...sb, table: e.target.value })} placeholder="registrations" className={inputClass} />
            </div>
            <div>
              <label htmlFor="sb-int" className={label}>
                Check every
              </label>
              <select id="sb-int" value={interval} onChange={(e) => setIntervalMinutes(Number(e.target.value))} className={inputClass}>
                {SYNC_INTERVALS.map((s) => (
                  <option key={s.minutes} value={s.minutes}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="sb-key" className={label}>
              API key
            </label>
            <input id="sb-key" type="password" autoComplete="off" value={sb.key} onChange={(e) => setSb({ ...sb, key: e.target.value })} placeholder={state.supabase.hasKey ? "Saved. Leave empty to keep it." : "Paste the key"} className={inputClass} />
            <p className={hint}>
              The service_role key can read every table, so keep it private. It is stored on the server and never shown again. If you prefer, make a read-only view and use the anon key with a read policy on it.
            </p>
          </div>
          <p className="text-xs text-muted">The table needs a column for the email and one for the name, such as email and full_name. Phone is optional. Other columns are kept as extra details.</p>
          <SyncLine last={state.supabase.lastSync} />
        </div>
      )}

      {source === "form" && tech && (
        <div className="space-y-5 mb-7">
          <div>
            <label className={label}>Address your form posts to</label>
            <div className="flex gap-2">
              <input readOnly value={state.form.endpoint} className={inputClass} onFocus={(e) => e.currentTarget.select()} />
              <Copy text={state.form.endpoint} what="the address" />
            </div>
          </div>
          {state.form.key ? (
            <div>
              <label className={label}>Secret key</label>
              <div className="flex gap-2">
                <input readOnly type={showKey ? "text" : "password"} value={state.form.key} className={inputClass} />
                <button type="button" className={ghostButton} onClick={() => setShowKey((v) => !v)}>
                  {showKey ? "Hide" : "Show"}
                </button>
                <Copy text={state.form.key} what="the key" />
              </div>
              <p className={hint}>Send it as the header x-intake-key, or as a form field named key. Anyone who views your page source can see it, so change it if it leaks. Changing it switches off the old one.</p>
              <button
                type="button"
                className="text-xs text-red-400 hover:underline mt-2"
                onClick={() => window.confirm("Change the key? Forms using the old key stop working until you update them.") && call("POST", { action: "regenerate_key" }, "key", "The key was changed.")}
              >
                Change the key
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted">Save to create the key.</p>
          )}
          <div>
            <label htmlFor="origins" className={label}>
              Allowed websites (optional)
            </label>
            <input id="origins" value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="https://pertinencegroup.com" className={inputClass} />
            <p className={hint}>When filled in, only these websites can post from a browser. Separate several with a space. Leave empty to allow any website.</p>
          </div>
          {state.form.key && (
            <div>
              <label className={label}>Example form</label>
              <pre className="bg-inputbg border border-border rounded-lg p-4 text-xs overflow-x-auto whitespace-pre">{snippet}</pre>
              <div className="mt-2">
                <Copy text={snippet} what="the example" />
              </div>
              <p className={hint}>The hidden field named website catches bots. Leave it in. Someone who registers twice with the same email is updated, not duplicated. Nobody is emailed by this: your own confirmation emails keep working as they do now.</p>
            </div>
          )}
        </div>
      )}

      {source === "manual" && <p className="text-sm text-muted mb-7">Use Import CSV and Add contact on the Contacts page.</p>}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          className={primaryButton}
          disabled={busy !== null}
          onClick={() => call("PUT", { dataSource: source, interval, origins, ...(source === "supabase" ? { supabase: sb } : {}) }, "save", "Saved.")}
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        {source === "supabase" && state.dataSource === "supabase" && state.supabase.hasKey && (
          <button className={ghostButton} disabled={busy !== null} onClick={() => call("POST", { action: "sync_supabase" }, "sync", "Done.")}>
            {busy === "sync" ? "Reading…" : "Read the table now"}
          </button>
        )}
        {message && <span className={`text-sm ${message.ok ? "text-muted" : "text-red-400"}`}>{message.text}</span>}
      </div>
    </div>
  );
}
