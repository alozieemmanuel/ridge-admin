"use client";

import { useEffect, useRef, useState } from "react";
import { assetUrl } from "@/components/Logo";
import { ACTION_WORDS, COLOR_PRESETS, MAX_TERM_LENGTH, PEOPLE_WORDS, normalizeHex, type Terms } from "@/lib/eventTheme";
import { inputClass } from "@/components/ui";

export interface LogoDraft {
  /** A link typed by the admin. */
  link: string;
  /** A file chosen on this device (uploaded when the form is saved). */
  file: File | null;
  /** The logo the event has now (a link or an uploaded file's address). */
  current: string | null;
  /** True when the admin removed the current logo. */
  removed: boolean;
}

export const emptyLogo = (current: string | null = null): LogoDraft => ({ link: "", file: null, current, removed: false });

export interface BrandDraft {
  brandName: string;
  color: string;
  logo: LogoDraft;
  logoDark: LogoDraft;
  terms: Terms;
}

/** The address of the picture to show for a draft: the chosen file, the typed link, or what the event has now. */
export function useLogoPreview(logo: LogoDraft): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!logo.file) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(logo.file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logo.file]);
  if (objectUrl) return objectUrl;
  if (logo.link.trim().startsWith("https://")) return logo.link.trim();
  if (logo.removed) return null;
  return logo.current ? assetUrl(logo.current) : null;
}

const labelClass = "block text-sm font-medium mb-1.5";
const hintClass = "text-xs text-muted mt-1.5";

function LogoPicker({ title, hint, value, onChange, dark }: { title: string; hint: string; value: LogoDraft; onChange: (v: LogoDraft) => void; dark?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const preview = useLogoPreview(value);
  const [problem, setProblem] = useState<string | null>(null);

  function pick(file: File | undefined) {
    setProblem(null);
    if (!file) return;
    if (file.size > 1_500_000) return setProblem("That image is over 1.5 MB. Use a smaller one.");
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return setProblem("Use a PNG, JPG, WebP or SVG image.");
    onChange({ ...value, file, link: "", removed: false });
  }

  return (
    <div>
      <p className={labelClass}>{title}</p>
      <div className="flex items-stretch gap-4 flex-wrap">
        <div className={`w-44 h-24 rounded-xl border border-dashed border-border flex items-center justify-center overflow-hidden shrink-0 ${dark ? "bg-[#0C0F08]" : "bg-white"}`}>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="max-h-16 max-w-[8.5rem] object-contain" />
          ) : (
            <span className={`text-xs px-3 text-center ${dark ? "text-[#a0aa8c]" : "text-muted"}`}>No logo yet</span>
          )}
        </div>
        <div className="flex-1 min-w-[15rem] space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} aria-label={`${title}: choose a file`} />
            <button type="button" onClick={() => input.current?.click()} className="text-sm px-4 py-2 rounded-full border border-border hover:border-gold transition-colors">
              {value.file ? "Choose another file" : "Upload a file"}
            </button>
            {(preview || value.file) && (
              <button type="button" onClick={() => onChange({ link: "", file: null, current: value.current, removed: true })} className="text-sm text-muted hover:text-fg underline">
                Remove
              </button>
            )}
            {value.file && <span className="text-xs text-muted truncate max-w-[12rem]">{value.file.name}</span>}
          </div>
          <input
            value={value.link}
            onChange={(e) => onChange({ ...value, link: e.target.value, file: null, removed: false })}
            placeholder="or paste a link, https://…"
            className={inputClass}
            aria-label={`${title}: link`}
          />
        </div>
      </div>
      {problem ? <p className="text-xs text-red-400 mt-1.5">{problem}</p> : <p className={hintClass}>{hint}</p>}
    </div>
  );
}

function Select({ value, options, onChange, id }: { value: string; options: string[]; onChange: (v: string) => void; id: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o === "__other" ? "Other…" : o}
        </option>
      ))}
    </select>
  );
}

/**
 * The brand and wording fields of an event: name, colour, logos, and what it calls its people.
 * Used by the creation wizard and by Settings, Branding, so both look and behave the same.
 */
export default function EventBrandFields({ value, onChange, fallbackName, section = "all" }: { value: BrandDraft; onChange: (v: BrandDraft) => void; fallbackName: string; section?: "brand" | "wording" | "all" }) {
  const showBrand = section !== "wording";
  const showWording = section !== "brand";
  const set = (patch: Partial<BrandDraft>) => onChange({ ...value, ...patch });
  const [hex, setHex] = useState(value.color);
  useEffect(() => setHex(value.color), [value.color]);

  const peopleKnown = PEOPLE_WORDS.some((p) => p.people === value.terms.people && p.person === value.terms.person);
  const [peopleOther, setPeopleOther] = useState(!peopleKnown);
  const actionKnown = ACTION_WORDS.includes(value.terms.action);
  const [actionOther, setActionOther] = useState(!actionKnown);

  return (
    <div className="space-y-7">
      {showBrand && (
        <>
      <div>
        <label htmlFor="brand-name" className={labelClass}>
          Brand name
        </label>
        <input id="brand-name" value={value.brandName} onChange={(e) => set({ brandName: e.target.value })} maxLength={80} placeholder={fallbackName || "e.g. Sales Pro Conference"} className={inputClass} />
        <p className={hintClass}>Shown on the guest page and in emails. Leave empty to use the event name.</p>
      </div>

      <div>
        <p className={labelClass}>Theme colour</p>
        <div className="flex flex-wrap items-center gap-2.5" role="radiogroup" aria-label="Theme colour">
          {COLOR_PRESETS.map((c) => {
            const on = value.color.toUpperCase() === c.hex;
            return (
              <button
                key={c.hex}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={c.name}
                title={c.name}
                onClick={() => set({ color: c.hex })}
                className={`h-9 w-9 rounded-full border-2 transition-transform ${on ? "border-fg scale-110" : "border-transparent hover:scale-105"}`}
                style={{ background: c.hex }}
              />
            );
          })}
          <label className="flex items-center gap-2 ml-1 text-sm text-muted">
            <input type="color" value={normalizeHex(value.color) ?? "#A3E635"} onChange={(e) => set({ color: e.target.value.toUpperCase() })} className="h-9 w-9 rounded-full border border-border bg-transparent p-0.5 cursor-pointer" aria-label="Pick any colour" />
            <input
              value={hex}
              onChange={(e) => {
                setHex(e.target.value);
                const n = normalizeHex(e.target.value);
                if (n) set({ color: n });
              }}
              maxLength={7}
              className="w-24 bg-inputbg border border-border rounded-lg px-3 py-2 text-sm font-mono text-fg focus:outline-none focus:border-gold"
              aria-label="Colour code"
            />
          </label>
        </div>
        <p className={hintClass}>Colours the menu, buttons and highlights of this event, its guest page and its emails.</p>
      </div>

      <div className="grid gap-6">
        <LogoPicker title="Logo" hint="PNG, JPG, WebP or SVG, up to 1.5 MB. A wide logo on a transparent background works best." value={value.logo} onChange={(logo) => set({ logo })} />
        <LogoPicker title="White logo for dark mode (optional)" hint="Without it, your logo sits on a white tile in dark mode." value={value.logoDark} onChange={(logoDark) => set({ logoDark })} dark />
      </div>
        </>
      )}

      {showWording && (
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="people-word" className={labelClass}>
            What do you call the people?
          </label>
          <Select
            id="people-word"
            value={peopleOther ? "__other" : value.terms.people}
            options={[...PEOPLE_WORDS.map((p) => p.people), "__other"]}
            onChange={(v) => {
              if (v === "__other") return setPeopleOther(true);
              setPeopleOther(false);
              const p = PEOPLE_WORDS.find((x) => x.people === v)!;
              set({ terms: { ...value.terms, person: p.person, people: p.people } });
            }}
          />
          {peopleOther && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input value={value.terms.person} maxLength={MAX_TERM_LENGTH} onChange={(e) => set({ terms: { ...value.terms, person: e.target.value } })} placeholder="One, e.g. Pro" className={inputClass} aria-label="Word for one person" />
              <input value={value.terms.people} maxLength={MAX_TERM_LENGTH} onChange={(e) => set({ terms: { ...value.terms, people: e.target.value } })} placeholder="Many, e.g. Pros" className={inputClass} aria-label="Word for many people" />
            </div>
          )}
          <p className={hintClass}>Used in the menu and headings, for example &quot;{value.terms.people}&quot;.</p>
        </div>
        <div>
          <label htmlFor="action-word" className={labelClass}>
            Guest button
          </label>
          <Select
            id="action-word"
            value={actionOther ? "__other" : value.terms.action}
            options={[...ACTION_WORDS, "__other"]}
            onChange={(v) => {
              if (v === "__other") return setActionOther(true);
              setActionOther(false);
              set({ terms: { ...value.terms, action: v } });
            }}
          />
          {actionOther && <input value={value.terms.action} maxLength={MAX_TERM_LENGTH} onChange={(e) => set({ terms: { ...value.terms, action: e.target.value } })} placeholder="Button text" className={`${inputClass} mt-2`} aria-label="Button text" />}
          <p className={hintClass}>The button on the guest&apos;s own page.</p>
        </div>
      </div>
      )}
    </div>
  );
}
