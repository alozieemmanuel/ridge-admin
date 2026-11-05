/**
 * Light formatting for email text. The message stays plain text; these markers become HTML when it is shown or sent:
 *   **bold**   *italic*   ++underline++   ***bold and italic***
 *   a line that starts with "- " is a bullet point
 *   a line that says [button] is where the reserve button goes (when the campaign has one)
 * A blank line starts a new paragraph. Everything is escaped first, so only these markers can ever become tags.
 * Safe to import from both server and client code (no server-only imports).
 */

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A marker only counts when the text inside does not start or end with a space, so "C++ and C++" or "2 * 3 * 4" are left alone.
const BOLD_ITALIC = /\*\*\*(?=[^\s*])(.+?)(?<=[^\s*])\*\*\*/g;
const BOLD = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
const UNDERLINE = /\+\+(?=\S)(.+?)(?<=\S)\+\+/g;
const ITALIC = /(?<![*\w])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![*\w])/g;
const BULLET = /^\s*[-•]\s+(.*)$/;
// Mailchimp merge tags such as *|FNAME|* contain asterisks. They are set aside while the markers are read.
const MERGE_TAG = /\*\|[^|*\s]+\|\*/g;

const BUTTON_LINE = /^\s*\[button\]\s*$/i;
const BUTTON_ANYWHERE = /^\s*\[button\]\s*$/im;

/** True when the text has a line that says [button], the spot the admin chose for the reserve button. */
export function hasButtonMarker(text: string): boolean {
  return BUTTON_ANYWHERE.test(text);
}

/** Turns the markers inside one line of already-escaped text into tags. */
function inline(escaped: string): string {
  const tags: string[] = [];
  const kept = escaped.replace(MERGE_TAG, (tag) => `\u0000${tags.push(tag) - 1}\u0000`);
  const formatted = kept
    .replace(BOLD_ITALIC, "<strong><em>$1</em></strong>")
    .replace(BOLD, "<strong>$1</strong>")
    .replace(UNDERLINE, "<u>$1</u>")
    .replace(ITALIC, "<em>$1</em>");
  return formatted.replace(/\u0000(\d+)\u0000/g, (_, i) => tags[Number(i)]);
}

/** The reserve button as shown on screen (the preview and the campaign history). The label is escaped. */
export function screenButtonHtml(label: string): string {
  return `<span style="display:inline-block;border:1px solid currentColor;border-radius:999px;padding:8px 18px;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;">${esc(label)}</span>`;
}

export type RichVariant = "email" | "screen";

/**
 * Plain text with markers to HTML.
 *  - "email": inline styles, black Arial text, for the email itself.
 *  - "screen": no colours, so it follows the dashboard theme (previews and the campaign history).
 * options.button is the HTML of the button. It is placed where a [button] line stands; without it, a [button] line shows nothing.
 */
export function richHtml(text: string, variant: RichVariant = "email", options: { button?: string } = {}): string {
  const email = variant === "email";
  const font = email ? "color:#000000;font-size:15px;line-height:1.6;font-family:Arial,sans-serif;" : "";
  const pStyle = `margin:0 0 ${email ? 14 : 10}px;${font}`;
  const ulStyle = `margin:0 0 ${email ? 14 : 10}px;padding-left:${email ? "22px" : "1.25rem"};${email ? "" : "list-style:disc;"}${font}`;
  const liStyle = "margin:0 0 6px;";
  const buttonStyle = `margin:6px 0 ${email ? 20 : 12}px;text-align:center;`;

  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      // Group the lines of a block into runs: consecutive bullet lines make one list, other lines make one paragraph,
      // and a [button] line is its own run, so the button can stand between two paragraphs or inside one.
      const runs: { kind: "p" | "ul" | "button"; lines: string[] }[] = [];
      for (const line of block.split("\n")) {
        if (BUTTON_LINE.test(line)) {
          runs.push({ kind: "button", lines: [] });
          continue;
        }
        const m = BULLET.exec(line);
        const kind = m ? "ul" : "p";
        const content = m ? m[1] : line.trim();
        const last = runs[runs.length - 1];
        if (last && last.kind === kind) last.lines.push(content);
        else runs.push({ kind, lines: [content] });
      }
      return runs
        .map((run) => {
          if (run.kind === "button") return options.button ? `<div style="${buttonStyle}">${options.button}</div>` : "";
          if (run.kind === "ul") return `<ul style="${ulStyle}">${run.lines.map((l) => `<li style="${liStyle}">${inline(esc(l))}</li>`).join("")}</ul>`;
          return `<p style="${pStyle}">${run.lines.map((l) => inline(esc(l))).join("<br/>")}</p>`;
        })
        .join("");
    })
    .join("");
}
