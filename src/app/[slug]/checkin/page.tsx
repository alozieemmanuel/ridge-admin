"use client";

import "@/lib/clientFetch";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { useEvent } from "@/lib/useEvent";
import { themeStyle } from "@/lib/eventTheme";
import { cacheClear } from "@/lib/clientCache";
import { inputClass } from "@/components/ui";
import QrScanner from "@/components/QrScanner";

interface Guest {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  category: string;
  ticketCode: string | null;
  reserved: boolean;
  checkedInAt: string | null;
  checkedInBy: string | null;
  canUndo: boolean;
}
type State = "checked_in" | "already" | "not_reserved" | "not_found";
interface Outcome {
  state: State;
  guest: Guest | null;
  code?: string;
  /** Checked in without a reserved seat (the official did it at the door). */
  walkIn?: boolean;
}

const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

const BANNER: Record<State, { title: string; tone: string }> = {
  checked_in: { title: "Checked in", tone: "border-emerald-500 bg-emerald-500/10 text-emerald-400" },
  already: { title: "Already checked in", tone: "border-amber-400 bg-amber-400/10 text-amber-400" },
  not_reserved: { title: "No seat reserved", tone: "border-red-500 bg-red-500/10 text-red-400" },
  not_found: { title: "Ticket not found", tone: "border-red-500 bg-red-500/10 text-red-400" },
};

function Details({ g }: { g: Guest }) {
  return (
    <dl className="text-sm grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 mt-2">
      <dt className="text-muted">Email</dt>
      <dd className="break-all">{g.email || "-"}</dd>
      <dt className="text-muted">Phone</dt>
      <dd>{g.phone || "-"}</dd>
      <dt className="text-muted">Category</dt>
      <dd>{g.category || "-"}</dd>
      {g.ticketCode && (
        <>
          <dt className="text-muted">Ticket</dt>
          <dd className="font-mono">{g.ticketCode}</dd>
        </>
      )}
    </dl>
  );
}

/** The standalone door screen. A ticket's QR code opens it with ?code=..., and the guest is checked in at once. */
export default function CheckinPage() {
  const router = useRouter();
  const { event, role, admin, denied } = useEvent();
  const doorStaff = role === "CHECKIN";
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [scanning, setScanning] = useState(false);
  const [counts, setCounts] = useState<{ checkedIn: number; reserved: number } | null>(null);
  const [recent, setRecent] = useState<Guest[]>([]);
  const [undoMinutes, setUndoMinutes] = useState(5);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Guest[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scanned = useRef<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newPerson, setNewPerson] = useState({ fullName: "", email: "", phone: "" });

  const call = useCallback(async (body: object) => {
    const res = await fetch("/api/admin/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 401) {
      router.replace("/login");
      throw new Error("Signed out");
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }, [router]);

  const loadStats = useCallback(async () => {
    const res = await fetch("/api/admin/checkin").catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      setCounts({ checkedIn: d.checkedIn, reserved: d.reserved });
      setRecent(d.recent);
      setUndoMinutes(d.undoMinutes ?? 5);
    }
  }, []);

  const scan = useCallback(
    async (code: string) => {
      setScanning(true);
      setError(null);
      setResults(null);
      try {
        const { ok, data } = await call({ action: "scan", code });
        if (!ok) setError(data.error || "Could not check this ticket.");
        else setOutcome({ state: data.state, guest: data.guest, code });
      } catch {
        setError("Could not reach the server. Check the connection and scan again.");
      } finally {
        setScanning(false);
        loadStats();
      }
    },
    [call, loadStats]
  );

  // A scanned QR code opens this page with ?code=. It is handled once, then removed from the address so a refresh does not repeat it.
  useEffect(() => {
    loadStats();
    const code = new URLSearchParams(window.location.search).get("code");
    if (code && scanned.current !== code) {
      scanned.current = code;
      window.history.replaceState(null, "", window.location.pathname);
      scan(code);
    }
  }, [scan, loadStats]);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setSearching(true);
    setError(null);
    setConfirmId(null);
    try {
      const { ok, data } = await call({ action: "search", q });
      if (ok) {
        setResults(data.guests);
        setOutcome(null);
      } else setError(data.error || "Search failed.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSearching(false);
    }
  }

  async function checkIn(g: Guest) {
    setBusyId(g.id);
    setError(null);
    try {
      const { ok, data } = await call({ action: "check_in", id: g.id });
      if (!ok) {
        setError(data.error || "Could not check in.");
        return;
      }
      setOutcome({ state: data.state, guest: data.guest });
      setResults(null);
      setQ("");
      setConfirmId(null);
      loadStats();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  /** A guest on the list who never reserved: seat them and check them in at once. */
  async function walkIn(g: Guest) {
    setBusyId(g.id);
    setError(null);
    try {
      const { ok, data } = await call({ action: "walk_in", id: g.id });
      if (!ok) {
        setError(data.error || "Could not check in.");
        return;
      }
      setOutcome({ state: data.state, guest: data.guest, walkIn: Boolean(data.walkIn) });
      setResults(null);
      setQ("");
      setConfirmId(null);
      loadStats();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  /** Someone who is not on the list at all: add them, seat them and check them in. */
  async function walkInNew(e: React.FormEvent) {
    e.preventDefault();
    setBusyId("new");
    setError(null);
    try {
      const { ok, data } = await call({ action: "walk_in_new", ...newPerson });
      if (!ok) {
        setError(data.error || "Could not add this person.");
        return;
      }
      setOutcome({ state: data.state, guest: data.guest, walkIn: Boolean(data.walkIn) });
      setResults(null);
      setAdding(false);
      setNewPerson({ fullName: "", email: "", phone: "" });
      setQ("");
      loadStats();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  async function undo(g: Guest) {
    setBusyId(g.id);
    setError(null);
    try {
      const { ok, data } = await call({ action: "undo", id: g.id });
      if (!ok) setError(data.error || "Could not undo.");
      else if (outcome?.guest?.id === g.id) setOutcome(null);
      loadStats();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  async function signOut() {
    await fetch("/api/admin/logout", { method: "POST" });
    cacheClear();
    router.push("/login");
    router.refresh();
  }

  const theme = themeStyle(event?.color);
  const banner = outcome ? BANNER[outcome.state] : null;

  return (
    <div className={`min-h-screen bg-pagebg text-fg${theme ? " event-themed" : ""}`} style={theme}>
      <header className="border-b border-border">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {event?.logoUrl ? <Logo className="h-8 w-auto" src={event.logoUrl} darkSrc={event.logoDarkUrl} name={event.brandName || event.name} /> : null}
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted">Check-in</p>
              <p className="text-sm font-medium truncate">{event?.name ?? ""}</p>
            </div>
          </div>
          <button onClick={signOut} className="text-xs text-muted hover:text-fg whitespace-nowrap">
            Sign out{admin?.name ? ` (${admin.name.split(" ")[0]})` : ""}
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6">
        {counts && (
          <p className="text-sm text-muted mb-5">
            <span className="text-fg font-medium text-lg">{counts.checkedIn}</span> checked in · {counts.reserved} with a seat
          </p>
        )}

        {denied && <p className="text-sm text-red-400 border border-red-500/40 rounded-xl p-3 mb-4">You have not been added to this event. Ask an owner for access.</p>}

        {camera ? (
          <QrScanner onCode={(text) => scan(text)} onClose={() => setCamera(false)} />
        ) : (
          <button onClick={() => setCamera(true)} className="w-full mb-6 text-base px-5 py-4 rounded-2xl bg-gold text-[#141C08] font-semibold">
            Scan a QR code with the camera
          </button>
        )}

        {scanning && <p className="text-center text-muted py-10">Checking the ticket…</p>}

        {error && <p className="text-sm text-red-400 border border-red-500/40 rounded-xl p-3 mb-4">{error}</p>}

        {!scanning && outcome && banner && (
          <section className={`border-2 rounded-2xl p-5 mb-6 ${banner.tone}`} aria-live="polite">
            <p className="text-xs uppercase tracking-widest">{banner.title}</p>
            {outcome.guest ? (
              <>
                <p className="font-serif text-3xl text-fg mt-1 break-words">{outcome.guest.fullName}</p>
                <div className="text-fg">
                  <Details g={outcome.guest} />
                </div>
                {outcome.state === "checked_in" && (
                  <p className="text-sm text-fg mt-3">
                    Checked in at {timeOf(outcome.guest.checkedInAt)}.{outcome.walkIn ? " No seat had been reserved, so one was added on the spot." : ""}
                  </p>
                )}
                {outcome.state === "already" && (
                  <p className="text-sm text-fg mt-3">
                    Was checked in at {timeOf(outcome.guest.checkedInAt)}
                    {outcome.guest.checkedInBy ? ` by ${outcome.guest.checkedInBy}` : ""}. Do not let this ticket in twice.
                  </p>
                )}
                {outcome.state === "not_reserved" && (
                  <div className="mt-3">
                    <p className="text-sm text-fg">This person is on the list but has not reserved a seat.</p>
                    <button onClick={() => walkIn(outcome.guest!)} disabled={busyId === outcome.guest.id} className="mt-3 text-sm px-4 py-2 rounded-full bg-gold text-[#141C08] font-semibold disabled:opacity-60">
                      {busyId === outcome.guest.id ? "Checking in…" : "Check in on the spot"}
                    </button>
                  </div>
                )}
                {outcome.state === "checked_in" && (outcome.guest.canUndo || !doorStaff) && (
                  <button onClick={() => undo(outcome.guest!)} disabled={busyId === outcome.guest.id} className="mt-4 text-sm px-4 py-2 rounded-full border border-current">
                    Wrong person? Undo
                  </button>
                )}
              </>
            ) : (
              <p className="text-fg mt-2 text-sm">
                No ticket {outcome.code ? <span className="font-mono">{outcome.code}</span> : ""} for this event. It may be cancelled, or belong to another event.
              </p>
            )}
          </section>
        )}

        {!scanning && !outcome && !results && (
          <p className="text-sm text-muted border border-dashed border-border rounded-2xl p-5 mb-6 text-center">
            Press the button above to scan a guest&apos;s QR code, or search for them below. They are checked in at once.
          </p>
        )}

        <section className="border border-border rounded-2xl p-4 mb-6">
          <p className="text-xs uppercase tracking-wider text-muted mb-2">Find a guest</p>
          <form onSubmit={search} className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Email, phone, name or ticket code"
              className={inputClass}
              aria-label="Email, phone, name or ticket code"
              autoComplete="off"
              inputMode="search"
            />
            <button type="submit" disabled={searching || q.trim().length < 2} className="text-sm px-5 rounded-full bg-gold text-[#141C08] font-semibold disabled:opacity-50">
              {searching ? "…" : "Find"}
            </button>
          </form>

          {results && (
            <ul className="mt-4 space-y-3">
              {results.length === 0 && <li className="text-sm text-muted">Nobody found. This person is not on the list. You can add them below and check them in.</li>}
              {results.map((g) => (
                <li key={g.id} className="border border-border rounded-xl p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium break-words">{g.fullName}</p>
                    <span className={`text-xs whitespace-nowrap ${g.checkedInAt ? "text-amber-400" : g.reserved ? "text-emerald-400" : "text-red-400"}`}>
                      {g.checkedInAt ? `Checked in ${timeOf(g.checkedInAt)}` : g.reserved ? "Seat reserved" : "No seat"}
                    </span>
                  </div>
                  <Details g={g} />
                  {g.reserved && !g.checkedInAt && (
                    <div className="mt-3">
                      {confirmId === g.id ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm">Check in {g.fullName}?</span>
                          <button onClick={() => checkIn(g)} disabled={busyId === g.id} className="text-sm px-4 py-2 rounded-full bg-emerald-500 text-black font-semibold disabled:opacity-60">
                            {busyId === g.id ? "Checking in…" : "Confirm"}
                          </button>
                          <button onClick={() => setConfirmId(null)} className="text-sm px-4 py-2 rounded-full border border-border">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmId(g.id)} className="text-sm px-4 py-2 rounded-full bg-gold text-[#141C08] font-semibold">
                          Check in
                        </button>
                      )}
                    </div>
                  )}
                  {!g.reserved && (
                    <div className="mt-3">
                      <p className="text-xs text-muted mb-2">No seat reserved yet. They can still be let in: this gives them a seat and checks them in.</p>
                      {confirmId === `walk:${g.id}` ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm">Check in {g.fullName} on the spot?</span>
                          <button onClick={() => walkIn(g)} disabled={busyId === g.id} className="text-sm px-4 py-2 rounded-full bg-emerald-500 text-black font-semibold disabled:opacity-60">
                            {busyId === g.id ? "Checking in…" : "Confirm"}
                          </button>
                          <button onClick={() => setConfirmId(null)} className="text-sm px-4 py-2 rounded-full border border-border">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmId(`walk:${g.id}`)} className="text-sm px-4 py-2 rounded-full bg-gold text-[#141C08] font-semibold">
                          Check in on the spot
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 pt-4 border-t border-border">
            {!adding ? (
              <button onClick={() => setAdding(true)} className="text-sm text-goldlight underline">
                Not on the list? Add them and check them in
              </button>
            ) : (
              <form onSubmit={walkInNew} className="space-y-3">
                <p className="text-xs uppercase tracking-wider text-muted">Add and check in</p>
                <input value={newPerson.fullName} onChange={(e) => setNewPerson({ ...newPerson, fullName: e.target.value })} placeholder="Full name" className={inputClass} aria-label="Full name" required autoComplete="off" />
                <input value={newPerson.email} onChange={(e) => setNewPerson({ ...newPerson, email: e.target.value })} placeholder={event?.emailOptional ? "Email (optional)" : "Email"} type="email" className={inputClass} aria-label="Email" required={!event?.emailOptional} autoComplete="off" />
                <input value={newPerson.phone} onChange={(e) => setNewPerson({ ...newPerson, phone: e.target.value })} placeholder="Phone (optional)" type="tel" className={inputClass} aria-label="Phone" autoComplete="off" />
                <div className="flex gap-2">
                  <button type="submit" disabled={busyId === "new" || !newPerson.fullName.trim()} className="text-sm px-5 py-2.5 rounded-full bg-gold text-[#141C08] font-semibold disabled:opacity-60">
                    {busyId === "new" ? "Checking in…" : "Add and check in"}
                  </button>
                  <button type="button" onClick={() => setAdding(false)} className="text-sm px-5 py-2.5 rounded-full border border-border">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>

        {recent.length > 0 && (
          <section>
            <p className="text-xs uppercase tracking-wider text-muted mb-2">Latest check-ins</p>
            <ul className="divide-y divide-border border border-border rounded-2xl">
              {recent.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{g.fullName}</p>
                    <p className="text-xs text-muted">
                      {timeOf(g.checkedInAt)}
                      {g.checkedInBy ? ` · ${g.checkedInBy}` : ""}
                    </p>
                  </div>
                  {(g.canUndo || !doorStaff) && (
                    <button onClick={() => undo(g)} disabled={busyId === g.id} className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-gold whitespace-nowrap">
                      Undo
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {doorStaff && <p className="text-xs text-muted mt-2">A check-in can be undone for {undoMinutes} minutes.</p>}
          </section>
        )}
      </main>
    </div>
  );
}
