"use client";

import { useCallback, useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/basePath";
import { useEventSlug } from "@/lib/useEvent";
import { PageHeader, StatCard, Pill, ghostButton, inputClass, primaryButton } from "@/components/ui";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import AdminShell from "@/components/AdminShell";

interface Question {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
  active: boolean;
}
interface Config {
  open: boolean;
  count: number;
  minutes: number;
  showAnswers: boolean;
  intro: string;
  bands: { min: number; label: string }[];
}
interface Result {
  id: string;
  rank: number | null;
  name: string;
  email: string;
  code: string | null;
  done: boolean;
  score: number | null;
  total: number;
  seconds: number | null;
  reward: string | null;
}

const mmss = (s: number | null) => (s == null ? "-" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const blank = { id: "", text: "", options: ["", "", "", ""], correctIndex: 0, active: true };

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}

function TestsInner() {
  const slug = useEventSlug();
  const [tab, setTab] = useState<"questions" | "entry" | "settings" | "results">("questions");
  const kind = tab === "entry" ? "ENTRY" : "TEST";
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const say = (text: string, ok = true) => setNote({ text, ok });

  const [questions, setQuestions] = useState<Question[]>([]);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [checkedIn, setCheckedIn] = useState(0);
  const [draft, setDraft] = useState<Question | null>(null);
  const [bulk, setBulk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState<{ config: { on: boolean; count: number; pass: number; attempts: number }; available: number; scores: { id: string; name: string; email: string; score: number | null; total: number | null; attempts: number; at: string | null; reserved: boolean }[] } | null>(null);
  const [results, setResults] = useState<{ results: Result[]; started: number; finished: number } | null>(null);

  const loadQuestions = useCallback(async () => {
    const r = await fetch(`/api/admin/tests/questions?kind=${kind}`, { cache: "no-store" });
    if (r.ok) setQuestions((await r.json()).questions);
  }, [kind]);
  const loadEntry = useCallback(async () => {
    const r = await fetch("/api/admin/tests/entry", { cache: "no-store" });
    if (r.ok) setEntry(await r.json());
  }, []);
  const loadSettings = useCallback(async () => {
    const r = await fetch("/api/admin/tests/settings", { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      setCfg((prev) => prev ?? j.config);
      setCheckedIn(j.checkedIn);
    }
  }, []);
  const loadResults = useCallback(async () => {
    const r = await fetch("/api/admin/tests/results", { cache: "no-store" });
    if (r.ok) setResults(await r.json());
  }, []);

  useEffect(() => {
    loadQuestions();
    loadSettings();
  }, [loadQuestions, loadSettings]);
  useEffect(() => {
    if (tab === "entry") loadEntry();
  }, [tab, loadEntry]);
  useEffect(() => {
    if (tab === "results") loadResults();
  }, [tab, loadResults]);
  useAutoRefresh(() => {
    if (tab === "results") return loadResults();
  }, 10_000);

  const active = questions.filter((q) => q.active).length;
  const link = typeof window === "undefined" ? "" : `${window.location.origin}${BASE_PATH}/${slug}/test`;

  async function saveQuestion() {
    if (!draft) return;
    setBusy(true);
    const body = { text: draft.text, options: draft.options, correctIndex: draft.correctIndex, kind };
    const r = draft.id ? await call(`/api/admin/tests/questions/${draft.id}`, "PUT", body) : await call("/api/admin/tests/questions", "POST", body);
    setBusy(false);
    if (!r.ok) return say(r.json.error || "Could not save.", false);
    setDraft(null);
    say("Question saved.");
    loadQuestions();
  }
  async function importBulk() {
    if (!bulk) return;
    setBusy(true);
    const r = await call("/api/admin/tests/questions", "POST", { bulk, kind });
    setBusy(false);
    if (!r.ok) return say(r.json.error || "Could not import.", false);
    setBulk(null);
    say(`${r.json.added} questions added.`);
    loadQuestions();
  }
  async function remove(q: Question) {
    if (!confirm("Delete this question? Papers already drawn keep their copy.")) return;
    const r = await call(`/api/admin/tests/questions/${q.id}`, "DELETE");
    if (r.ok) loadQuestions();
    else say(r.json.error || "Could not delete.", false);
  }
  async function toggle(q: Question) {
    await call(`/api/admin/tests/questions/${q.id}`, "PUT", { active: !q.active });
    loadQuestions();
  }
  async function saveSettings(patch: Partial<Config>, okText = "Saved.") {
    setBusy(true);
    const r = await call("/api/admin/tests/settings", "PUT", patch);
    setBusy(false);
    if (!r.ok) return say(r.json.error || "Could not save.", false);
    setCfg((c) => (c ? { ...c, ...patch } : c));
    say(okText);
  }
  async function resetGuest(id: string, name: string) {
    if (!confirm(`Give ${name} their tries back?`)) return;
    const r = await call("/api/admin/tests/entry", "POST", { id });
    if (r.ok) loadEntry();
    else say(r.json.error || "Could not reset.", false);
  }
  async function saveEntry(patch: { on?: boolean; count?: number; pass?: number; attempts?: number }, okText = "Saved.") {
    setBusy(true);
    const r = await call("/api/admin/tests/entry", "PUT", patch);
    setBusy(false);
    if (!r.ok) return say(r.json.error || "Could not save.", false);
    say(okText);
    loadEntry();
  }
  async function reset(row: Result) {
    if (!confirm(`Let ${row.name} take the test again? Their current attempt is deleted.`)) return;
    const r = await call(`/api/admin/tests/attempts/${row.id}`, "DELETE");
    if (r.ok) loadResults();
    else say(r.json.error || "Could not reset.", false);
  }

  const tabBtn = (k: typeof tab, label: string) => (
    <button onClick={() => setTab(k)} className={`px-4 py-2 text-sm rounded-full border ${tab === k ? "border-gold text-goldlight" : "border-border text-muted"}`}>
      {label}
    </button>
  );

  return (
    <AdminShell>
      <PageHeader title="Tests" subtitle="Guests who are checked in sign in with their ticket code. Each person gets their own random paper." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Test" value={cfg?.open ? "Open" : "Closed"} tone={cfg?.open ? "text-emerald-400" : "text-muted"} />
        <StatCard label="Active questions" value={active} hint={tab === "entry" ? (entry ? `${entry.config.count} per guest` : undefined) : cfg ? `${cfg.count} per person` : undefined} />
        <StatCard label="Checked in" value={checkedIn} hint="can take the test" />
        <StatCard label="Finished" value={results ? `${results.finished}/${results.started}` : "-"} hint="finished / started" />
      </div>

      {note && (
        <p role="status" className={`border rounded-xl p-3 mb-5 text-sm ${note.ok ? "border-gold/40" : "border-red-400/50 text-red-400"}`}>
          {note.text}
        </p>
      )}

      <div className="flex gap-2 mb-6 flex-wrap">
        {tabBtn("questions", `Questions (${questions.length})`)}
        {tabBtn("entry", "Entry quiz")}
        {tabBtn("settings", "Settings and rewards")}
        {tabBtn("results", "Results")}
      </div>

      {tab === "entry" && entry && (
        <section className="border border-border rounded-xl p-5 bg-cardbg mb-6 max-w-2xl">
          <h3 className="font-serif text-xl mb-1">Quiz before reserving a seat</h3>
          <p className="text-sm text-muted mb-4">When it is on, a guest who opens their reserve link must answer a few random questions first. They need the pass mark to see the Reserve button, and they get a limited number of tries. Questions are the ones in the list below.</p>
          <div className="grid sm:grid-cols-3 gap-4 mb-4">
            <label className="text-sm">
              Questions each guest gets
              <input type="number" min={1} className={`${inputClass} mt-1`} value={entry.config.count} onChange={(e) => setEntry({ ...entry, config: { ...entry.config, count: Number(e.target.value) } })} />
            </label>
            <label className="text-sm">
              Pass mark in percent (100 = all right)
              <input type="number" min={0} max={100} className={`${inputClass} mt-1`} value={entry.config.pass} onChange={(e) => setEntry({ ...entry, config: { ...entry.config, pass: Number(e.target.value) } })} />
            </label>
            <label className="text-sm">
              Tries each guest gets
              <input type="number" min={1} max={20} className={`${inputClass} mt-1`} value={entry.config.attempts} onChange={(e) => setEntry({ ...entry, config: { ...entry.config, attempts: Number(e.target.value) } })} />
            </label>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Pill tone={entry.config.on ? "text-emerald-400" : "text-muted"}>{entry.config.on ? "On" : "Off"}</Pill>
            <button className={primaryButton} disabled={busy} onClick={() => saveEntry({ count: entry.config.count, pass: entry.config.pass, attempts: entry.config.attempts })}>
              Save
            </button>
            <button className={ghostButton} disabled={busy} onClick={() => saveEntry({ on: !entry.config.on, count: entry.config.count, pass: entry.config.pass, attempts: entry.config.attempts }, entry.config.on ? "Quiz switched off." : "Quiz switched on.")}>
              {entry.config.on ? "Switch off" : "Switch on"}
            </button>
          </div>
          {entry.available < entry.config.count && <p className="text-xs text-muted mt-3">You have {entry.available} active questions below. Add at least {entry.config.count} to switch it on.</p>}
          {entry.scores.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <p className="text-xs uppercase tracking-wider text-muted mb-2">Scores so far</p>
              <table className="w-full text-sm">
                <tbody>
                  {entry.scores.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="py-2 pr-3">
                        {s.name}
                        <div className="text-xs text-muted">{s.email}</div>
                      </td>
                      <td className="py-2 pr-3">
                        {s.score}/{s.total}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted">{s.attempts} {s.attempts === 1 ? "try" : "tries"}</td>
                      <td className="py-2 pr-3 text-xs text-muted">{s.reserved ? "Reserved" : "Not reserved"}</td>
                      <td className="py-2 text-xs">
                        {!s.reserved && (
                          <button className="text-goldlight" onClick={() => resetGuest(s.id, s.name)}>
                            Give tries back
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {(tab === "questions" || tab === "entry") && (
        <section>
          {(tab === "entry" ? active < (entry?.config.count ?? 5) : active < (cfg?.count ?? 20)) && (
            <p className="text-sm border border-border rounded-xl p-3 mb-5 text-muted">
              {tab === "entry" ? "Add more questions for the entry quiz." : `You need at least ${cfg?.count ?? 20} active questions before the test can open. You have ${active}.`}
            </p>
          )}
          <div className="flex gap-3 flex-wrap mb-5">
            <button className={primaryButton} onClick={() => setDraft({ ...blank })}>
              Add a question
            </button>
            <button className={ghostButton} onClick={() => setBulk("")}>
              Paste many questions
            </button>
          </div>

          {bulk !== null && (
            <div className="border border-gold/40 rounded-xl p-4 mb-5 bg-cardbg">
              <p className="text-sm mb-2">Leave a blank line between questions. First line is the question, then one option per line. Start the correct option with a star.</p>
              <pre className="text-xs text-muted bg-inputbg rounded-lg p-3 mb-3 whitespace-pre-wrap">{`What is the first step of a sales call?\nPitch the price\n*Build rapport\nClose the deal\nEnd the call\n\nNext question here\n...`}</pre>
              <textarea className={`${inputClass} h-56 font-mono`} value={bulk} onChange={(e) => setBulk(e.target.value)} />
              <div className="flex gap-3 mt-3">
                <button className={primaryButton} disabled={busy || !bulk.trim()} onClick={importBulk}>
                  {busy ? "Adding…" : "Add questions"}
                </button>
                <button className={ghostButton} onClick={() => setBulk(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {draft && (
            <div className="border border-gold/40 rounded-xl p-4 mb-5 bg-cardbg space-y-3">
              <textarea className={`${inputClass} h-20`} placeholder="Question" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
              {draft.options.map((o, i) => (
                <div key={i} className="flex items-center gap-3">
                  <input type="radio" name="correct" checked={draft.correctIndex === i} onChange={() => setDraft({ ...draft, correctIndex: i })} aria-label={`Option ${i + 1} is correct`} />
                  <input className={inputClass} placeholder={`Option ${i + 1}`} value={o} onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                  {draft.options.length > 2 && (
                    <button
                      className="text-xs text-muted"
                      onClick={() => {
                        const options = draft.options.filter((_, j) => j !== i);
                        setDraft({ ...draft, options, correctIndex: Math.min(draft.correctIndex > i ? draft.correctIndex - 1 : draft.correctIndex, options.length - 1) });
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted">The filled circle marks the correct option. People never see this order, it is shuffled for each person.</p>
              <div className="flex gap-3 flex-wrap">
                {draft.options.length < 6 && (
                  <button className={ghostButton} onClick={() => setDraft({ ...draft, options: [...draft.options, ""] })}>
                    Add option
                  </button>
                )}
                <button className={primaryButton} disabled={busy} onClick={saveQuestion}>
                  {busy ? "Saving…" : "Save question"}
                </button>
                <button className={ghostButton} onClick={() => setDraft(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <ol className="space-y-3">
            {questions.map((q, n) => (
              <li key={q.id} className={`border border-border rounded-xl p-4 bg-cardbg ${q.active ? "" : "opacity-60"}`}>
                <p className="font-medium mb-2">
                  {n + 1}. {q.text}
                </p>
                <ul className="text-sm space-y-1 mb-3">
                  {q.options.map((o, i) => (
                    <li key={i} className={i === q.correctIndex ? "text-emerald-400" : "text-muted"}>
                      {i === q.correctIndex ? "✓ " : "· "}
                      {o}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-4 text-xs">
                  <button className="text-goldlight" onClick={() => setDraft({ ...q })}>
                    Edit
                  </button>
                  <button className="text-muted" onClick={() => toggle(q)}>
                    {q.active ? "Switch off" : "Switch on"}
                  </button>
                  <button className="text-red-400" onClick={() => remove(q)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {questions.length === 0 && <p className="text-muted text-sm">No questions yet.</p>}
          </ol>
        </section>
      )}

      {tab === "settings" && cfg && (
        <section className="space-y-6 max-w-2xl">
          <div className="border border-border rounded-xl p-5 bg-cardbg">
            <h3 className="font-serif text-xl mb-1">Open the test</h3>
            <p className="text-sm text-muted mb-4">Open it after the teaching. While it is closed, nobody can start. People already writing can finish.</p>
            <div className="flex items-center gap-4 flex-wrap">
              <Pill tone={cfg.open ? "text-emerald-400" : "text-muted"}>{cfg.open ? "Open" : "Closed"}</Pill>
              <button className={cfg.open ? ghostButton : primaryButton} disabled={busy} onClick={() => saveSettings({ open: !cfg.open }, cfg.open ? "Test closed." : "Test is open.")}>
                {cfg.open ? "Close the test" : "Open the test"}
              </button>
            </div>
            <p className="text-xs text-muted mt-4 mb-1">Link for guests</p>
            <div className="flex gap-2 items-center flex-wrap">
              <code className="text-sm break-all">{link}</code>
              <button className="text-xs text-goldlight" onClick={() => navigator.clipboard?.writeText(link).then(() => say("Link copied."))}>
                Copy
              </button>
            </div>
          </div>

          <div className="border border-border rounded-xl p-5 bg-cardbg">
            <h3 className="font-serif text-xl mb-4">The test</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="text-sm">
                Questions per person
                <input type="number" min={1} className={`${inputClass} mt-1`} value={cfg.count} onChange={(e) => setCfg({ ...cfg, count: Number(e.target.value) })} />
              </label>
              <label className="text-sm">
                Minutes allowed
                <input type="number" min={1} className={`${inputClass} mt-1`} value={cfg.minutes} onChange={(e) => setCfg({ ...cfg, minutes: Number(e.target.value) })} />
              </label>
            </div>
            <label className="text-sm block mt-4">
              Message on the start screen (optional)
              <textarea className={`${inputClass} mt-1 h-20`} value={cfg.intro} onChange={(e) => setCfg({ ...cfg, intro: e.target.value })} />
            </label>
            <label className="flex items-center gap-2 text-sm mt-4">
              <input type="checkbox" checked={cfg.showAnswers} onChange={(e) => setCfg({ ...cfg, showAnswers: e.target.checked })} />
              Show the score and correct answers when they finish
            </label>
          </div>

          <div className="border border-border rounded-xl p-5 bg-cardbg">
            <h3 className="font-serif text-xl mb-1">Rewards by score</h3>
            <p className="text-sm text-muted mb-4">Each person gets the highest band their percentage reaches.</p>
            <div className="space-y-2">
              {cfg.bands.map((b, i) => (
                <div key={i} className="flex gap-3 items-center">
                  <input type="number" min={0} max={100} className={`${inputClass} w-24`} value={b.min} onChange={(e) => setCfg({ ...cfg, bands: cfg.bands.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)) })} />
                  <span className="text-sm text-muted">% and above</span>
                  <input className={inputClass} placeholder="Reward" value={b.label} onChange={(e) => setCfg({ ...cfg, bands: cfg.bands.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <button className="text-xs text-red-400" onClick={() => setCfg({ ...cfg, bands: cfg.bands.filter((_, j) => j !== i) })}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button className={`${ghostButton} mt-3`} onClick={() => setCfg({ ...cfg, bands: [...cfg.bands, { min: 80, label: "" }] })}>
              Add a band
            </button>
          </div>

          <button
            className={primaryButton}
            disabled={busy}
            onClick={() => saveSettings({ count: cfg.count, minutes: cfg.minutes, intro: cfg.intro, showAnswers: cfg.showAnswers, bands: cfg.bands.filter((b) => b.label.trim()) })}
          >
            {busy ? "Saving…" : "Save settings"}
          </button>
        </section>
      )}

      {tab === "results" && (
        <section>
          <div className="flex gap-3 mb-4 flex-wrap">
            <a className={ghostButton} href={`/api/admin/tests/results?format=csv&event=${slug}`}>
              Download CSV
            </a>
          </div>
          <div className="border border-border rounded-xl overflow-x-auto bg-cardbg">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="p-3">Rank</th>
                  <th className="p-3">Name</th>
                  <th className="p-3">Ticket</th>
                  <th className="p-3">Score</th>
                  <th className="p-3">Time</th>
                  <th className="p-3">Reward</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {results?.results.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-3">{r.rank ?? "-"}</td>
                    <td className="p-3">
                      {r.name}
                      <div className="text-xs text-muted">{r.email}</div>
                    </td>
                    <td className="p-3 font-mono text-xs">{r.code}</td>
                    <td className="p-3">{r.done ? `${r.score}/${r.total} (${r.total ? Math.round(((r.score ?? 0) / r.total) * 100) : 0}%)` : <Pill>In progress</Pill>}</td>
                    <td className="p-3">{mmss(r.seconds)}</td>
                    <td className="p-3">{r.reward ?? "-"}</td>
                    <td className="p-3">
                      <button className="text-xs text-muted hover:text-red-400" onClick={() => reset(r)}>
                        Let retake
                      </button>
                    </td>
                  </tr>
                ))}
                {results && results.results.length === 0 && (
                  <tr>
                    <td className="p-4 text-muted" colSpan={7}>
                      Nobody has started yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </AdminShell>
  );
}

export default function TestsPage() {
  return <TestsInner />;
}
