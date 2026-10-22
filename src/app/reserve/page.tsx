"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import { primaryButton } from "@/components/ui";

interface View {
  guest: { fullName: string; email: string; phone: string | null; organization: string | null };
  event: { name: string; caption: string; date: string; time: string; venue: string; contactEmail: string; contactPhone: string };
  reserved: boolean;
  full: boolean;
  ticket: { code: string; qrSvg: string; checkedIn: boolean } | null;
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.15em] text-muted mb-1">{label}</p>
      <p className="font-medium break-words">{value || "To be announced"}</p>
    </div>
  );
}

function ReserveInner() {
  const token = useSearchParams().get("t") || "";
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [justReserved, setJustReserved] = useState<{ emailSent: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError("This link is missing its access code. Please use the link in your invitation email, or contact the team.");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/public/reserve?t=${encodeURIComponent(token)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error || "We couldn't open your invitation. Please try again.");
      else setView(json);
    } catch {
      setError("We couldn't reach the server. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function reserve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public/reserve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token }) });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setView(json);
        if (!json.alreadyReserved) setJustReserved({ emailSent: json.emailSent !== false });
      } else {
        setError(json.error || "We couldn't reserve your seat. Please try again.");
        if (json.code === "FULL") load();
      }
    } catch {
      setError("We couldn't reach the server. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const contact = view ? [view.event.contactEmail, view.event.contactPhone].filter(Boolean).join(" or ") : "";

  return (
    <div className="min-h-screen bg-tint">
      <header className="bg-pagebg border-b border-border">
        <div className="max-w-2xl mx-auto px-5 py-5 flex justify-center">
          <Logo className="h-10 w-auto" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-10">
        {loading && <p className="text-muted text-center">Loading your invitation…</p>}

        {!loading && !view && error && (
          <div className="bg-pagebg border border-border rounded-2xl p-8 text-center">
            <h1 className="font-serif text-2xl mb-3">We couldn&apos;t open your invitation</h1>
            <p className="text-muted text-sm leading-relaxed">{error}</p>
          </div>
        )}

        {view && (
          <>
            <div className="text-center mb-8">
              <p className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{view.event.caption || "By invitation only"}</p>
              <h1 className="font-serif text-3xl sm:text-4xl mb-3">{view.event.name}</h1>
              <p className="text-muted">
                {view.reserved ? `Your seat is reserved, ${view.guest.fullName.split(/\s+/)[0]}.` : `You're invited, ${view.guest.fullName.split(/\s+/)[0]}.`}
              </p>
            </div>

            {justReserved && (
              <div role="status" className="border border-gold bg-gold/15 rounded-xl p-4 mb-6 text-sm text-center">
                <strong>Your seat is reserved.</strong>{" "}
                {justReserved.emailSent ? `Your ticket has been emailed to ${view.guest.email}.` : "We couldn't email your ticket just now, but it is below, and the team can resend it."}
              </div>
            )}
            {error && (
              <p role="alert" className="border border-red-400/50 text-red-400 rounded-xl p-4 mb-6 text-sm text-center">
                {error}
              </p>
            )}

            <section className="bg-pagebg border border-border rounded-2xl p-6 mb-6">
              <h2 className="text-xs uppercase tracking-wider text-muted mb-4">The event</h2>
              <div className="grid sm:grid-cols-3 gap-5">
                <Field label="Date" value={view.event.date} />
                <Field label="Time" value={view.event.time} />
                <Field label="Venue" value={view.event.venue} />
              </div>
            </section>

            <section className="bg-pagebg border border-border rounded-2xl p-6 mb-6">
              <h2 className="text-xs uppercase tracking-wider text-muted mb-4">Your details</h2>
              <div className="grid sm:grid-cols-2 gap-5">
                <Field label="Name" value={view.guest.fullName} />
                <Field label="Email" value={view.guest.email} />
                {view.guest.phone && <Field label="Phone" value={view.guest.phone} />}
                {view.guest.organization && <Field label="Company" value={view.guest.organization} />}
              </div>
            </section>

            {!view.reserved && !view.full && (
              <div className="text-center">
                <button onClick={reserve} disabled={busy} className={`${primaryButton} text-base px-10 py-4`}>
                  {busy ? "Reserving…" : "Reserve My Seat"}
                </button>
                <p className="text-xs text-muted mt-4">One click. Your entry ticket will be emailed to you straight away.</p>
              </div>
            )}

            {!view.reserved && view.full && (
              <div className="bg-pagebg border border-border rounded-2xl p-6 text-center">
                <h2 className="font-serif text-xl mb-2">All seats have been taken</h2>
                <p className="text-sm text-muted">We&apos;re sorry, the room is now full.{contact ? ` Please contact us on ${contact} if you have any questions.` : ""}</p>
              </div>
            )}

            {view.reserved && view.ticket && (
              <section className="bg-pagebg border-2 border-gold rounded-2xl overflow-hidden" aria-label="Your ticket">
                <div className="bg-gold px-6 py-4 text-[#141C08]">
                  <p className="text-[11px] uppercase tracking-[0.2em] font-bold">Admit one · By invitation</p>
                  <p className="font-serif text-xl font-bold mt-1">{view.event.name}</p>
                </div>
                <div className="px-6 pt-5 pb-4">
                  <Field label="Guest" value={view.guest.fullName} />
                  <div className="grid grid-cols-2 gap-5 mt-4">
                    <Field label="Date" value={view.event.date} />
                    <Field label="Time" value={view.event.time} />
                  </div>
                  <div className="mt-4">
                    <Field label="Venue" value={view.event.venue} />
                  </div>
                </div>
                <div className="border-t-2 border-dashed border-border mx-4" />
                <div className="px-6 py-5 bg-tint flex items-center gap-5 flex-wrap">
                  <div className="w-40 h-40 bg-white rounded-lg p-1.5 shrink-0 [&_svg]:w-full [&_svg]:h-full" dangerouslySetInnerHTML={{ __html: view.ticket.qrSvg }} aria-label={`QR code for ticket ${view.ticket.code}`} role="img" />
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.15em] text-muted mb-1">Ticket code</p>
                    <p className="font-mono text-2xl tracking-wider font-bold">{view.ticket.code}</p>
                    <p className="text-sm text-muted mt-2 max-w-xs">Show this at the entrance. Take a screenshot so you have it even without a signal.</p>
                    {view.ticket.checkedIn && <p className="text-sm text-emerald-400 mt-2 font-medium">You have been checked in.</p>}
                  </div>
                </div>
              </section>
            )}

            {contact && <p className="text-xs text-muted text-center mt-8">Questions? Contact us on {contact}.</p>}
          </>
        )}
      </main>
    </div>
  );
}

export default function ReservePage() {
  return (
    <Suspense fallback={null}>
      <ReserveInner />
    </Suspense>
  );
}
