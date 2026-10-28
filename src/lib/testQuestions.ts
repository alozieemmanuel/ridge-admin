export function cleanQuestion(raw: { text?: unknown; options?: unknown; correctIndex?: unknown; active?: unknown }): { error: string } | { text: string; options: string[]; correctIndex: number; active: boolean } {
  const text = String(raw.text ?? "").trim();
  const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o ?? "").trim()) : [];
  const correctIndex = Number(raw.correctIndex);
  if (!text) return { error: "Write the question." };
  if (options.length < 2 || options.length > 6 || options.some((o) => !o)) return { error: "Give 2 to 6 options and fill each one in." };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return { error: "Two options are the same." };
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return { error: "Mark the correct option." };
  return { text: text.slice(0, 1000), options: options.map((o) => o.slice(0, 400)), correctIndex, active: raw.active !== false };
}

/** Pasted text: blocks separated by a blank line. First line is the question, then one option per line, the correct one starts with *. */
export function parseBulk(text: string): { questions: { text: string; options: string[]; correctIndex: number }[]; errors: string[] } {
  const questions: { text: string; options: string[]; correctIndex: number }[] = [];
  const errors: string[] = [];
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  blocks.forEach((block, i) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const q = lines[0].replace(/^\d+[.)]\s*/, "");
    const rest = lines.slice(1);
    const stars = rest.filter((l) => l.startsWith("*")).length;
    const options = rest.map((l) => l.replace(/^\*\s*/, "").replace(/^[A-Fa-f][.)]\s+/, ""));
    const correctIndex = rest.findIndex((l) => l.startsWith("*"));
    const c = cleanQuestion({ text: q, options, correctIndex });
    if ("error" in c || stars !== 1) errors.push(`Question ${i + 1}: ${"error" in c ? c.error : "mark exactly one correct option with *"}`);
    else questions.push({ text: c.text, options: c.options, correctIndex: c.correctIndex });
  });
  return { questions, errors };
}

