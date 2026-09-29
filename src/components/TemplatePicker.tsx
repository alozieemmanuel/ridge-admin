"use client";

import { useEffect, useState } from "react";

export interface TemplateInfo {
  name: string;
  language: string;
  category: string;
  bodyText: string;
  variableCount: number;
  supported: boolean;
  unsupportedReason?: string;
}

const inputClass =
  "w-full bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold";
const labelClass = "block text-xs uppercase tracking-wider text-muted mb-2";

/** Loads approved WhatsApp templates; lets the admin pick one and fill its {{1}}, {{2}} variables. */
export default function TemplatePicker({
  personalize,
  onChange,
}: {
  /** show the {{first_name}} hint (broadcasts) */
  personalize?: boolean;
  onChange: (value: { template: TemplateInfo | null; params: string[]; ready: boolean }) => void;
}) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [params, setParams] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/admin/whatsapp/templates")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Couldn't load templates.");
        setTemplates(data.templates);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load templates."))
      .finally(() => setLoading(false));
  }, []);

  const template = templates.find((t) => `${t.name}|${t.language}` === selected) ?? null;

  useEffect(() => {
    const filled = template ? params.slice(0, template.variableCount) : [];
    const ready = Boolean(template && template.supported && filled.length === template.variableCount && filled.every((p) => p.trim()));
    onChange({ template, params: filled, ready });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, params, templates]);

  function pick(value: string) {
    setSelected(value);
    const t = templates.find((x) => `${x.name}|${x.language}` === value);
    setParams(t ? Array.from({ length: t.variableCount }, () => "") : []);
  }

  if (loading) return <p className="text-sm text-muted">Loading templates…</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (templates.length === 0) {
    return <p className="text-sm text-muted">No approved templates found. Create and get one approved in Meta Business Manager first.</p>;
  }

  return (
    <div>
      <label className={labelClass}>Template</label>
      <select value={selected} onChange={(e) => pick(e.target.value)} className={`${inputClass} mb-4`}>
        <option value="">Choose a template</option>
        {templates.map((t) => (
          <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`} disabled={!t.supported}>
            {t.name} ({t.language}){t.supported ? "" : ` - not supported: ${t.unsupportedReason}`}
          </option>
        ))}
      </select>

      {template && (
        <>
          <div className="border border-border rounded-lg px-4 py-3 text-sm whitespace-pre-wrap text-muted mb-4">{template.bodyText}</div>
          {template.variableCount > 0 && (
            <div className="space-y-3">
              {Array.from({ length: template.variableCount }, (_, i) => (
                <div key={i}>
                  <label className={labelClass}>Value for {`{{${i + 1}}}`}</label>
                  <input
                    value={params[i] ?? ""}
                    onChange={(e) => setParams((prev) => prev.map((p, idx) => (idx === i ? e.target.value : p)))}
                    className={inputClass}
                  />
                </div>
              ))}
              {personalize && (
                <p className="text-xs text-muted">
                  Use {"{{first_name}}"} or {"{{full_name}}"} in a value to personalize it for each person.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
