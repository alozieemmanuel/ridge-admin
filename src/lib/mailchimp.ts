import { createHash } from "crypto";

/**
 * Sends a campaign through Mailchimp's own campaigns (Marketing API), not through the sender list.
 * The guests are put in your Mailchimp audience, a campaign is created for just them, and Mailchimp sends it.
 * Mailchimp skips anyone who has unsubscribed there. Keys stay in the server environment:
 *   MAILCHIMP_API_KEY      the Marketing API key (ends with the data centre, for example -us9)
 *   MAILCHIMP_AUDIENCE_ID  the audience (list) the guests are added to
 *   MAILCHIMP_FROM         "Name <address>" shown as the sender (the address must be confirmed in Mailchimp)
 */

export function mailchimpConfigured(): boolean {
  return Boolean(process.env.MAILCHIMP_API_KEY && process.env.MAILCHIMP_AUDIENCE_ID && process.env.MAILCHIMP_FROM);
}

function clean(v: string | undefined): string {
  return (v || "").trim().replace(/^["']+|["']+$/g, "").trim();
}

function config() {
  const key = clean(process.env.MAILCHIMP_API_KEY);
  const audience = clean(process.env.MAILCHIMP_AUDIENCE_ID);
  const from = clean(process.env.MAILCHIMP_FROM);
  const dc = key.split("-")[1];
  if (!key || !dc) throw new Error("MAILCHIMP_API_KEY is missing or wrong. It should end with the data centre, for example -us9.");
  if (!audience) throw new Error("MAILCHIMP_AUDIENCE_ID is not set on the server.");
  if (!from) throw new Error("MAILCHIMP_FROM is not set on the server.");
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const email = (m ? m[2] : from).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`MAILCHIMP_FROM is not an email address (it reads "${from.slice(0, 40)}"). Use the form Name <you@example.com>, with no quotes around it.`);
  return { key, audience, dc, fromName: m ? m[1].trim() : "", fromEmail: email };
}

async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; data: T }> {
  const c = config();
  const res = await fetch(`https://${c.dc}.api.mailchimp.com/3.0${path}`, {
    method: init.method || "GET",
    headers: { Authorization: `Basic ${Buffer.from(`any:${c.key}`).toString("base64")}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

function problem(r: { status: number; data: unknown }): string {
  const d = r.data as { title?: string; detail?: string; errors?: { field?: string; message?: string }[] } | null;
  const extra = d?.errors?.length ? ` (${d.errors.map((e) => `${e.field ? e.field + ": " : ""}${e.message}`).join("; ").slice(0, 300)})` : "";
  return `Mailchimp ${r.status}${d?.title ? ` ${d.title}` : ""}: ${d?.detail || "request failed"}${extra}`;
}

/** Only the merge values that have something in them: an empty last name is left out rather than sent as "". */
function mergeFields(g: MailchimpGuest): Record<string, string> {
  const m: Record<string, string> = { RSVLINK: g.link };
  if (g.firstName.trim()) m.FNAME = g.firstName.trim();
  if (g.lastName.trim()) m.LNAME = g.lastName.trim();
  return m;
}

const md5 = (email: string) => createHash("md5").update(email.trim().toLowerCase()).digest("hex");

export interface MailchimpGuest {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  link: string;
}

/** The merge field that holds each guest's own reserve link. Created once, if it is not there yet. */
async function ensureLinkField(): Promise<void> {
  const c = config();
  const list = await api<{ merge_fields?: { tag: string }[] }>(`/lists/${c.audience}/merge-fields?count=100&fields=merge_fields.tag`);
  if (!list.ok) throw new Error(problem(list));
  if (list.data.merge_fields?.some((f) => f.tag === "RSVLINK")) return;
  const made = await api(`/lists/${c.audience}/merge-fields`, { method: "POST", body: { tag: "RSVLINK", name: "Reserve link", type: "text", required: false, public: false } });
  if (!made.ok) throw new Error(problem(made));
}

export interface MailchimpResult {
  sent: MailchimpGuest[];
  /** Guests Mailchimp will not email (unsubscribed there, or removed), with the reason. */
  left: { guest: MailchimpGuest; reason: string }[];
  mailchimpCampaignId: string;
  /** How many guests were left out for each reason, biggest first. */
  reasons: { reason: string; count: number }[];
}

function tally(left: { reason: string }[]): { reason: string; count: number }[] {
  const m = new Map<string, number>();
  for (const l of left) m.set(l.reason, (m.get(l.reason) || 0) + 1);
  return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

/**
 * Adds the guests to the audience (an existing member keeps their status, so nobody who unsubscribed is re-subscribed),
 * makes a campaign for just them, checks it and sends it. Throws with a readable reason when something is wrong.
 */
export async function sendMailchimpCampaign(opts: { name: string; subject: string; html: string; guests: MailchimpGuest[]; budgetMs?: number }): Promise<MailchimpResult> {
  const c = config();
  const started = Date.now();
  const budget = opts.budgetMs ?? 200_000;
  await ensureLinkField();

  const sent: MailchimpGuest[] = [];
  const left: { guest: MailchimpGuest; reason: string }[] = [];
  const byEmail = new Map(opts.guests.map((g) => [g.email.toLowerCase(), g]));

  // Mailchimp's batch endpoint takes up to 500 members per request, so 1,800 guests is 4 requests rather than 1,800.
  // An existing member keeps their status (status_if_new only applies to new ones), so nobody who unsubscribed is re-subscribed.
  const batches: MailchimpGuest[][] = [];
  for (let i = 0; i < opts.guests.length; i += 500) batches.push(opts.guests.slice(i, i + 500));
  type Member = { email_address: string; status?: string };
  type BatchReply = { new_members?: Member[]; updated_members?: Member[]; errors?: { email_address?: string; error?: string; error_code?: string }[] };
  const queue = [...batches];
  const worker = async () => {
    for (let batch = queue.shift(); batch; batch = queue.shift()) {
      if (Date.now() - started > budget) throw new Error("Adding the guests to Mailchimp took too long. Nothing was sent. Try again, guests already added are quick to update.");
      const r = await api<BatchReply>(`/lists/${c.audience}`, {
        method: "POST",
        body: {
          update_existing: true,
          // Without this, Mailchimp refuses a guest whose merge fields do not satisfy the audience's field rules (for example a guest with only one name).
          skip_merge_validation: true,
          members: batch.map((g) => ({ email_address: g.email, status_if_new: "subscribed", merge_fields: mergeFields(g) })),
        },
      });
      if (!r.ok) throw new Error(problem(r));
      const seen = new Set<string>();
      for (const m of [...(r.data.new_members || []), ...(r.data.updated_members || [])]) {
        const g = byEmail.get(m.email_address.toLowerCase());
        if (!g) continue;
        seen.add(g.email.toLowerCase());
        if (m.status === "subscribed") sent.push(g);
        else left.push({ guest: g, reason: `Not emailed: ${m.status || "not subscribed"} in Mailchimp` });
      }
      // A refused address (for example one Mailchimp considers fake) only drops that person.
      for (const e of r.data.errors || []) {
        const g = e.email_address ? byEmail.get(e.email_address.toLowerCase()) : undefined;
        if (!g || seen.has(g.email.toLowerCase())) continue;
        seen.add(g.email.toLowerCase());
        left.push({ guest: g, reason: `Mailchimp refused this address${e.error_code || e.error ? `: ${[e.error_code, e.error].filter(Boolean).join(" ").slice(0, 160)}` : ""}` });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker));
  // The batch call refuses some guests with "merge fields were invalid" without saying which field. Adding one guest at a time
  // is slower but names the field. The first refused guest is tried alone: if Mailchimp still refuses, stop at once with its exact reason.
  const isMerge = (l: { reason: string }) => /merge fields were invalid/i.test(l.reason);
  const retry = left.filter(isMerge);
  if (retry.length) {
    for (let i = left.length - 1; i >= 0; i--) if (isMerge(left[i])) left.splice(i, 1);
    const putOne = async (g: MailchimpGuest) =>
      api<{ status?: string }>(`/lists/${c.audience}/members/${md5(g.email)}`, {
        method: "PUT",
        body: { email_address: g.email, status_if_new: "subscribed", skip_merge_validation: true, merge_fields: mergeFields(g) },
      });
    const settle = (g: MailchimpGuest, r: { ok: boolean; status: number; data: { status?: string } }) => {
      if (r.ok && r.data.status === "subscribed") sent.push(g);
      else if (r.ok) left.push({ guest: g, reason: `Not emailed: ${r.data.status || "not subscribed"} in Mailchimp` });
      else left.push({ guest: g, reason: `Mailchimp refused this address: ${problem(r).slice(0, 200)}` });
    };
    const probe = await putOne(retry[0].guest);
    if (!probe.ok && probe.status !== 429 && /merge|field/i.test(problem(probe))) {
      throw new Error(`Mailchimp refuses these guests because of a field problem. Nothing was sent. Tested on ${retry[0].guest.email}: ${problem(probe)}`);
    }
    settle(retry[0].guest, probe);
    const rest = retry.slice(1).map((l) => l.guest);
    const again = async () => {
      for (let g = rest.shift(); g; g = rest.shift()) {
        if (Date.now() - started > budget) throw new Error("Adding the guests to Mailchimp took too long. Nothing was sent. Try again, guests already added are skipped faster.");
        settle(g, await putOne(g));
      }
    };
    await Promise.all(Array.from({ length: 8 }, again));
  }
  // Unsubscribed, cleaned (bounced before) and archived contacts are skipped on purpose. Anything else (refused addresses, a full audience)
  // means the audience is not ready, so stop BEFORE a campaign exists in Mailchimp instead of sending to only part of the list.
  const reasons = tally(left);
  const unexpected = left.filter((l) => !/: (unsubscribed|cleaned|archived) in Mailchimp$/.test(l.reason));
  if (unexpected.length > Math.max(5, Math.floor(opts.guests.length * 0.02))) {
    const top = tally(unexpected).slice(0, 3).map((r) => `${r.count} x ${r.reason}`).join(" | ");
    throw new Error(`Mailchimp would only take ${sent.length} of ${opts.guests.length} guests, so nothing was sent and no campaign was created. Reasons: ${top}`);
  }
  if (sent.length === 0) throw new Error("Mailchimp would not email any of these guests (they are unsubscribed or refused there). Nothing was sent.");

  const seg = await api<{ id: number }>(`/lists/${c.audience}/segments`, { method: "POST", body: { name: `${opts.name} ${new Date().toISOString().slice(0, 16)}`.slice(0, 100), static_segment: sent.map((g) => g.email) } });
  if (!seg.ok) throw new Error(problem(seg));

  const camp = await api<{ id: string }>("/campaigns", {
    method: "POST",
    body: {
      type: "regular",
      recipients: { list_id: c.audience, segment_opts: { saved_segment_id: seg.data.id } },
      settings: { subject_line: opts.subject.slice(0, 150), title: `${opts.name}: ${opts.subject.replace(/\*\|[^|]*\|\*/g, "").trim()}`.slice(0, 100), from_name: c.fromName || opts.name, reply_to: c.fromEmail, auto_footer: false },
    },
  });
  if (!camp.ok) throw new Error(problem(camp));

  const content = await api(`/campaigns/${camp.data.id}/content`, { method: "PUT", body: { html: opts.html } });
  if (!content.ok) throw new Error(problem(content));

  const check = await api<{ is_ready?: boolean; items?: { type: string; heading: string; details: string }[] }>(`/campaigns/${camp.data.id}/send-checklist`);
  if (check.ok && check.data.is_ready === false) {
    const why = (check.data.items || []).filter((i) => i.type === "error").map((i) => `${i.heading} ${i.details}`.replace(/<[^>]+>/g, "")).join(" | ");
    await api(`/campaigns/${camp.data.id}`, { method: "DELETE" });
    throw new Error(`Mailchimp is not ready to send: ${why || "unknown reason"}`);
  }

  const go = await api(`/campaigns/${camp.data.id}/actions/send`, { method: "POST" });
  if (!go.ok) throw new Error(problem(go));
  return { sent, left, mailchimpCampaignId: camp.data.id, reasons };
}

/** Adds the unsubscribe link and address that Mailchimp requires, if the email does not already have them. */
export function withMailchimpFooter(html: string, eventName: string): string {
  if (html.includes("*|UNSUB|*")) return html;
  const footer = `<div style="max-width:560px;margin:16px auto 24px;padding:0 20px;text-align:center;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a8a8a;">You are getting this because you are on the guest list for ${eventName.replace(/[<>&]/g, "")}.<br><a href="*|UNSUB|*" style="color:#8a8a8a;">Unsubscribe</a><br>*|LIST:ADDRESS|*</div>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footer}</body>`) : html + footer;
}
