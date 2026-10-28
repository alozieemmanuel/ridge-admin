"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import { themeStyle } from "@/lib/eventTheme";
import { useEventSeed } from "@/components/EventSeed";
import { primaryButton, ghostButton, inputClass } from "@/components/ui";

interface Brand {
  name: string;
  color: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
}
interface PaperQ {
  qid: string;
  text: string;
  options: string[];
}
interface Review {
  text: string;
  options: string[];
  correct: number;
  chosen: number | null;
}
interface Reply {
  state?: "not_checked_in" | "closed" | "ready" | "running" | "done";
  name?: string;
  eventName?: string;
  brand?: Brand;
  minutes?: number;
  count?: number;
  intro?: string;
  deadline?: string;
  serverNow?: string;
  paper?: PaperQ[];
  answers?: Record<string, number>;
  result?: { score: number; total: number; reward: string | null; review: Review[] | null };
  error?: string;
}

const KEY = (slug: string) => `test-code:${slug}`;

function TestInner() {
  const { slug } = useParams<{ slug: string }>();
  const seed = useEventSeed();
  const prefill = useSearchParams().get("code") || "";
  const [code, setCode] = useState(prefill);
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const [data, setData] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [index, setIndex] = useState(0);
  const [left, setLeft] = useState<number | null>(null);
  const offset = useRef(0); // server time minus this phone's time
  const submitting = useRef(false);

  const call = useCallback(
    async (action: string, c: string, extra: Record<string, unknown> = {}) => {
      const res = await fetch("/api/public/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, slug, code: c, ...extra }) });
      const json: Reply = await res.json().catch(() => ({ error: "Something went wrong." }));
      return { ok: res.ok, json };
    },
    [slug],
  );

  const apply = useCallback((json: Reply) => {
    setData(json);
    if (json.state === "running") {
      offset.current = json.serverNow ? new Date(json.serverNow).getTime() - Date.now() : 0;
      setAnswers(json.answers ?? {});
    }
  }, []);

  const enter = useCallback(
    async (c: string) => {
      setBusy(true);
      setError(null);
      try {
        const { ok, json } = await call("status", c);
        if (!ok) {
          setError(json.error || "Could not sign in.");
          if (json.brand) setData((d) => d ?? ({ brand: json.brand } as Reply));
          return;
        }
        try {
          sessionStorage.setItem(KEY(slug), c);
        } catch {}
        setSignedIn(c);
        apply(json);
      } catch {
        setError("We could not reach the server. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    },
    [call, apply, slug],
  );

  useEffect(() => {
    let saved = "";
    try {
      saved = sessionStorage.getItem(KEY(slug)) || "";
    } catch {}
    if (saved) enter(saved);
  }, [slug, enter]);

  async function start() {
    if (!signedIn) return;
    setBusy(true);
    setError(null);
    const { ok, json } = await call("start", signedIn);
    setBusy(false);
    if (!ok) return setError(json.error || "Could not start.");
    setIndex(0);
    apply(json);
  }

  const submit = useCallback(async () => {
    if (!signedIn || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const { ok, json } = await call("submit", signedIn);
      if (ok) apply(json);
      else setError(json.error || "Could not submit. Try again.");
    } catch {
      setError("We could not reach the server. Try again.");
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }, [call, signedIn, apply]);

  async function choose(q: PaperQ, i: number) {
    if (!signedIn) return;
    setAnswers((a) => ({ ...a, [q.qid]: i }));
    call("answer", signedIn, { qid: q.qid, choice: i }).catch(() => {});
  }

  // Countdown from the server's deadline.
  useEffect(() => {
    if (data?.state !== "running" || !data.deadline) return;
    const end = new Date(data.deadline).getTime();
    const tick = () => {
      const s = Math.max(0, Math.round((end - (Date.now() + offset.current)) / 1000));
      setLeft(s);
      if (s <= 0) submit();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [data, submit]);

  const brand = data?.brand;
  const theme = themeStyle(brand?.color ?? seed?.color);
  const logo = brand?.logoUrl ?? seed?.logoUrl;
  const total = data?.paper?.length ?? 0;
  const q = data?.paper?.[index];
  const answered = data?.paper ? data.paper.filter((p) => Number.isInteger(answers[p.qid])).length : 0;

  function leave() {
    try {
      sessionStorage.removeItem(KEY(slug));
    } catch {}
    setSignedIn(null);
    setData(null);
    setCode("");
  }

  return (
    <div className={`min-h-screen bg-tint${theme ? " event-themed" : ""}`} style={theme}>
      <header className="bg-pagebg border-b border-border">
        <div className="max-w-2xl mx-auto px-5 py-5 flex justify-center items-center min-h-[4.5rem] relative">
          {logo ? <Logo className="h-10 w-auto" src={logo} darkSrc={brand ? brand.logoDarkUrl : seed?.logoDarkUrl} name={brand?.name || seed?.brandName || seed?.name} /> : <Logo className="h-10 w-auto" />}
          {data?.state === "running" && left !== null && (
            <span className={`absolute right-5 font-mono text-sm px-3 py-1 rounded-full border ${left <= 60 ? "border-red-400 text-red-400" : "border-border"}`} aria-label="Time left">
              {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8">
        {!signedIn && (
          <div className="bg-pagebg border border-border rounded-2xl p-6 sm:p-8">
            <h1 className="font-serif text-2xl mb-2 text-center">{seed?.name || "Event"} test</h1>
            <p className="text-muted text-sm text-center mb-6">Enter the ticket code from your ticket.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                enter(code);
              }}
            >
              <input className={`${inputClass} text-center font-mono text-lg tracking-wider uppercase`} placeholder="Ticket code" value={code} autoCapitalize="characters" autoComplete="off" onChange={(e) => setCode(e.target.value)} />
              {error && (
                <p role="alert" className="text-red-400 text-sm mt-3 text-center">
                  {error}
                </p>
              )}
              <button className={`${primaryButton} w-full mt-4`} disabled={busy || !code.trim()}>
                {busy ? "Checking…" : "Continue"}
              </button>
            </form>
          </div>
        )}

        {signedIn && data?.state === "not_checked_in" && (
          <div className="bg-pagebg border border-border rounded-2xl p-6 sm:p-8 text-center">
            <h1 className="font-serif text-2xl mb-3">Please check in first</h1>
            <p className="text-muted text-sm leading-relaxed mb-6">Hello {data.name}. Only guests who are checked in at the event can take the test. Please see the team at the entrance, then try again.</p>
            <div className="flex gap-3 justify-center">
              <button className={primaryButton} onClick={() => enter(signedIn)} disabled={busy}>
                Try again
              </button>
              <button className={ghostButton} onClick={leave}>
                Use another code
              </button>
            </div>
          </div>
        )}

        {signedIn && data?.state === "closed" && (
          <div className="bg-pagebg border border-border rounded-2xl p-6 sm:p-8 text-center">
            <h1 className="font-serif text-2xl mb-3">The test is not open yet</h1>
            <p className="text-muted text-sm leading-relaxed mb-6">Hello {data.name}. The test opens after the teaching. Wait for the team to announce it, then tap the button below.</p>
            <button className={primaryButton} onClick={() => enter(signedIn)} disabled={busy}>
              Check again
            </button>
          </div>
        )}

        {signedIn && data?.state === "ready" && (
          <div className="bg-pagebg border border-border rounded-2xl p-6 sm:p-8">
            <h1 className="font-serif text-2xl mb-3 text-center">Hello {data.name}</h1>
            {data.intro && <p className="text-sm text-muted text-center mb-4 whitespace-pre-line">{data.intro}</p>}
            <ul className="text-sm text-muted space-y-2 mb-6 list-disc pl-5">
              <li>{data.count} questions, {data.minutes} minutes.</li>
              <li>The timer starts when you press Start and cannot be paused.</li>
              <li>You can take the test once. Your answers save as you go.</li>
              <li>If time runs out, your test is submitted for you.</li>
            </ul>
            {error && (
              <p role="alert" className="text-red-400 text-sm mb-3 text-center">
                {error}
              </p>
            )}
            <button className={`${primaryButton} w-full`} onClick={start} disabled={busy}>
              {busy ? "Starting…" : "Start the test"}
            </button>
          </div>
        )}

        {signedIn && data?.state === "running" && q && (
          <div>
            <div className="flex justify-between text-xs text-muted mb-2">
              <span>
                Question {index + 1} of {total}
              </span>
              <span>{answered} answered</span>
            </div>
            <div className="h-1.5 bg-border rounded-full mb-5 overflow-hidden">
              <div className="h-full bg-gold" style={{ width: `${((index + 1) / total) * 100}%` }} />
            </div>
            <section className="bg-pagebg border border-border rounded-2xl p-5 sm:p-6">
              <h2 className="font-medium text-lg mb-5 leading-snug">{q.text}</h2>
              <div className="space-y-3">
                {q.options.map((o, i) => {
                  const on = answers[q.qid] === i;
                  return (
                    <button key={i} onClick={() => choose(q, i)} className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${on ? "border-gold bg-gold/15" : "border-border hover:border-gold"}`}>
                      {o}
                    </button>
                  );
                })}
              </div>
            </section>
            {error && (
              <p role="alert" className="text-red-400 text-sm mt-3 text-center">
                {error}
              </p>
            )}
            <div className="flex justify-between gap-3 mt-5">
              <button className={ghostButton} disabled={index === 0} onClick={() => setIndex(index - 1)}>
                Back
              </button>
              {index < total - 1 ? (
                <button className={primaryButton} onClick={() => setIndex(index + 1)}>
                  Next
                </button>
              ) : (
                <button
                  className={primaryButton}
                  disabled={busy}
                  onClick={() => {
                    if (answered < total && !confirm(`You have ${total - answered} unanswered. Submit anyway?`)) return;
                    submit();
                  }}
                >
                  {busy ? "Submitting…" : "Submit"}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-6 justify-center" aria-label="Jump to a question">
              {data.paper!.map((p, i) => (
                <button key={p.qid} onClick={() => setIndex(i)} className={`w-8 h-8 text-xs rounded-md border ${i === index ? "border-gold text-goldlight" : Number.isInteger(answers[p.qid]) ? "border-gold/40 bg-gold/10" : "border-border text-muted"}`}>
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}

        {signedIn && data?.state === "done" && data.result && (
          <div>
            <div className="bg-pagebg border border-border rounded-2xl p-6 sm:p-8 text-center mb-6">
              <h1 className="font-serif text-2xl mb-2">Test submitted</h1>
              {data.result.review ? (
                <>
                  <p className="font-serif text-5xl my-4">
                    {data.result.score}/{data.result.total}
                  </p>
                  {data.result.reward && <p className="text-goldlight font-medium">Reward: {data.result.reward}</p>}
                </>
              ) : (
                <p className="text-muted text-sm mt-3">Thank you, {data.name}. Results will be announced by the team.</p>
              )}
              <button className={`${ghostButton} mt-5`} onClick={leave}>
                Done
              </button>
            </div>
            {data.result.review && (
              <ol className="space-y-4">
                {data.result.review.map((r, n) => (
                  <li key={n} className="bg-pagebg border border-border rounded-xl p-4">
                    <p className="font-medium text-sm mb-3">
                      {n + 1}. {r.text}
                    </p>
                    <ul className="space-y-1.5 text-sm">
                      {r.options.map((o, i) => (
                        <li key={i} className={i === r.correct ? "text-emerald-400" : i === r.chosen ? "text-red-400" : "text-muted"}>
                          {i === r.correct ? "✓ " : i === r.chosen ? "✗ " : "· "}
                          {o}
                          {i === r.chosen && i !== r.correct ? " (your answer)" : ""}
                        </li>
                      ))}
                    </ul>
                    {r.chosen === null && <p className="text-xs text-muted mt-2">Not answered</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function TestPage() {
  return (
    <Suspense fallback={null}>
      <TestInner />
    </Suspense>
  );
}
