/**
 * Prospect call times are typed by hand in the Google Sheet ("2 Oct 2026, 4:00 PM",
 * "02/10/2026", "2026-10-02"...). This reads the DAY out of that text so the
 * dashboard can count the calls due today. It returns "YYYY-MM-DD" or null.
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";

function ymd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function parseScheduleDay(text: string | null | undefined, now: Date = new Date()): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;

  // 2026-10-02
  let m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return ymd(+m[1], +m[2], +m[3]);

  // 02/10/2026, 2.10.26, 2-10-2026 (day first, the way it is written in Nigeria)
  m = t.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/);
  if (m) {
    let a = +m[1];
    let b = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (a <= 12 && b > 12) [a, b] = [b, a]; // clearly month/day
    return ymd(y, b, a);
  }

  // 2 Oct 2026, 2nd of October, 2 Oct
  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s*(\\d{4}))?`, "i"));
  if (m) return ymd(m[3] ? +m[3] : now.getFullYear(), MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);

  // Oct 2, 2026, October 2nd
  m = t.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`, "i"));
  if (m) return ymd(m[3] ? +m[3] : now.getFullYear(), MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);

  return null;
}
