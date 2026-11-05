/**
 * Light formatting for email text. The message stays plain text; these markers become HTML when it is shown or sent:
 *   **bold**   *italic*   ++underline++   ***bold and italic***
 *   a line that starts with "- " is a bullet point
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

/** Turns the markers inside one line of already-escaped text into tags. */
function inline(escaped: string): string {
  return escaped
    .replace(BOLD_ITALIC, "<strong><em>$1</em></strong>")
    .replace(BOLD, "<strong>$1</strong>")
    .replace(UNDERLINE, "<u>$1</u>")
    .replace(ITALIC, "<em>$1</em>");
}

export type RichVariant = "email" | "screen";

/**
 * Plain text with markers to HTML.
 *  - "email": inline styles, black Arial text, for the email itself.
 *  - "screen": no colours, so it follows the dashboard theme (previews and the campaign history).
 */
export function richHtml(text: string, variant: RichVariant = "email"): string {
  const email = variant === "email";
  const font = email ? "color:#000000;font-size:15px;line-height:1.6;font-family:Arial,sans-serif;" : "";
  const pStyle = `margin:0 0 ${email ? 14 : 10}px;${font}`;
  const ulStyle = `margin:0 0 ${email ? 14 : 10}px;padding-left:${email ? "22px" : "1.25rem"};${email ? "" : "list-style:disc;"}${font}`;
  const liStyle = "margin:0 0 6px;";

  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      // Group the lines of a block into runs: consecutive bullet lines make one list, other lines make one paragraph.
      const runs: { bullet: boolean; lines: string[] }[] = [];
      for (const line of block.split("\n")) {
        const m = BULLET.exec(line);
        const bullet = m !== null;
        const content = m ? m[1] : line.trim();
        const last = runs[runs.length - 1];
        if (last && last.bullet === bullet) last.lines.push(content);
        else runs.push({ bullet, lines: [content] });
      }
      return runs
        .map((run) =>
          run.bullet
            ? `<ul style="${ulStyle}">${run.lines.map((l) => `<li style="${liStyle}">${inline(esc(l))}</li>`).join("")}</ul>`
            : `<p style="${pStyle}">${run.lines.map((l) => inline(esc(l))).join("<br/>")}</p>`
        )
        .join("");
    })
    .join("");
}
