"use client";

import type { KeyboardEvent, RefObject } from "react";

/**
 * Formatting buttons for a plain textarea. They wrap the selected text in markers (see src/lib/richText.ts):
 * **bold**, *italic*, ++underline++, and "- " at the start of a line for bullet points.
 * The text stays plain; the markers become formatting when the email is built.
 */

function reselect(el: HTMLTextAreaElement, from: number, to: number) {
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(from, to);
  });
}

function isWrapped(value: string, start: number, end: number, marker: string): boolean {
  if (value.slice(start - marker.length, start) !== marker || value.slice(end, end + marker.length) !== marker) return false;
  // A single * must not be mistaken for one half of a ** (bold) pair.
  if (marker === "*" && (value[start - 2] === "*" || value[end + 1] === "*")) return false;
  return true;
}

function wrap(el: HTMLTextAreaElement, value: string, marker: string, onChange: (v: string) => void) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = value.slice(start, end);
  const n = marker.length;

  // Markers just outside the selection: take them off.
  if (isWrapped(value, start, end, marker)) {
    onChange(value.slice(0, start - n) + selected + value.slice(end + n));
    reselect(el, start - n, end - n);
    return;
  }
  // Markers inside the selection: take them off.
  if (selected.length >= n * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(n, selected.length - n);
    onChange(value.slice(0, start) + inner + value.slice(end));
    reselect(el, start, start + inner.length);
    return;
  }
  const inner = selected || "text";
  onChange(value.slice(0, start) + marker + inner + marker + value.slice(end));
  reselect(el, start + n, start + n + inner.length);
}

function bullets(el: HTMLTextAreaElement, value: string, onChange: (v: string) => void) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nl = value.indexOf("\n", end);
  const lineEnd = nl === -1 ? value.length : nl;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const isBullet = (l: string) => /^\s*[-•]\s/.test(l);
  const filled = lines.filter((l) => l.trim() !== "");
  const allBullets = filled.length > 0 && filled.every(isBullet);
  const next = lines.map((l) => (l.trim() === "" ? l : allBullets ? l.replace(/^(\s*)[-•]\s+/, "$1") : isBullet(l) ? l : `- ${l}`)).join("\n");
  onChange(value.slice(0, lineStart) + next + value.slice(lineEnd));
  reselect(el, lineStart, lineStart + next.length);
}

/** Puts a [button] line at the cursor, in a paragraph of its own: that is where the reserve button will appear in the email. */
function insertButton(el: HTMLTextAreaElement, value: string, onChange: (v: string) => void) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const before = value.slice(0, start);
  const after = value.slice(end);
  // Enough line breaks on each side to leave a blank line between the button and the text around it.
  const newlines = (text: string, fromEnd: boolean) => {
    const n = fromEnd ? text.length - text.replace(/\n+$/, "").length : text.length - text.replace(/^\n+/, "").length;
    return "\n".repeat(Math.max(0, 2 - n));
  };
  const lead = before === "" ? "" : newlines(before, true);
  const trail = after === "" ? "" : newlines(after, false);
  const marker = "[button]";
  onChange(before + lead + marker + trail + after);
  const caret = before.length + lead.length + marker.length + trail.length;
  reselect(el, caret, caret);
}

/** Ctrl/Cmd + B, I and U on the textarea. Pass this as its onKeyDown. */
export function formatKeyHandler(e: KeyboardEvent<HTMLTextAreaElement>, value: string, onChange: (v: string) => void) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  const marker = e.key === "b" || e.key === "B" ? "**" : e.key === "i" || e.key === "I" ? "*" : e.key === "u" || e.key === "U" ? "++" : null;
  if (!marker) return;
  e.preventDefault();
  wrap(e.currentTarget, value, marker, onChange);
}

const button =
  "min-w-[2.25rem] text-sm px-3 py-1.5 rounded-lg border border-border text-muted hover:border-gold hover:text-fg transition-colors whitespace-nowrap";

export default function FormatToolbar({
  textareaRef,
  value,
  onChange,
  onButton,
}: {
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (v: string) => void;
  /** When given, a "Button" control is shown. It is called after the [button] line is inserted (so the page can switch the button on). */
  onButton?: () => void;
}) {
  // onMouseDown keeps the selection in the textarea while a button is pressed.
  const run = (action: (el: HTMLTextAreaElement) => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (textareaRef.current) action(textareaRef.current);
  };

  return (
    <div className="flex items-center gap-2 mb-2 flex-wrap" role="toolbar" aria-label="Text formatting">
      <button type="button" className={`${button} font-bold`} onMouseDown={run((el) => wrap(el, value, "**", onChange))} title="Bold (Ctrl+B)" aria-label="Bold">
        B
      </button>
      <button type="button" className={`${button} italic`} onMouseDown={run((el) => wrap(el, value, "*", onChange))} title="Italic (Ctrl+I)" aria-label="Italic">
        I
      </button>
      <button type="button" className={`${button} underline`} onMouseDown={run((el) => wrap(el, value, "++", onChange))} title="Underline (Ctrl+U)" aria-label="Underline">
        U
      </button>
      <button type="button" className={button} onMouseDown={run((el) => bullets(el, value, onChange))} title="Bullet points" aria-label="Bullet points">
        • List
      </button>
      {onButton && (
        <button
          type="button"
          className={button}
          onMouseDown={run((el) => {
            insertButton(el, value, onChange);
            onButton();
          })}
          title="Put the reserve button at the cursor"
          aria-label="Insert reserve button"
        >
          + Button
        </button>
      )}
    </div>
  );
}
