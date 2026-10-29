/**
 * Browser side of "send the waiting emails": asks the server for one short run at a time (about 40 seconds each) and keeps
 * asking until nothing is waiting, a sender cannot send, or the page asks to stop. Stopping loses nothing: what is left stays in
 * the queue, and "Send waiting emails now" picks it up again.
 */
export interface FlushProgress {
  sent: number;
  failed: number;
  skipped: number;
  waiting: number;
  blocked: string | null;
}

export async function flushUntilDone(opts: { campaignId?: string; onProgress?: (p: FlushProgress) => void; shouldStop?: () => boolean } = {}): Promise<FlushProgress & { error?: string }> {
  const total: FlushProgress = { sent: 0, failed: 0, skipped: 0, waiting: 0, blocked: null };
  let quiet = 0;
  for (let i = 0; i < 400; i++) {
    if (opts.shouldStop?.()) break;
    let json: Partial<FlushProgress> & { error?: string } = {};
    try {
      const res = await fetch("/api/admin/senders/flush", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: opts.campaignId }) });
      json = await res.json().catch(() => ({}));
      if (!res.ok) return { ...total, error: json.error || "Could not send." };
    } catch {
      return { ...total, error: "Lost the connection. Nothing is lost: press Send waiting emails now to carry on." };
    }
    total.sent += json.sent ?? 0;
    total.failed += json.failed ?? 0;
    total.skipped += json.skipped ?? 0;
    total.waiting = json.waiting ?? 0;
    total.blocked = json.blocked ?? null;
    opts.onProgress?.({ ...total });
    if (total.waiting === 0 || total.blocked) break;
    // A run that did nothing twice in a row is not going to get anywhere.
    quiet = (json.sent ?? 0) + (json.failed ?? 0) + (json.skipped ?? 0) === 0 ? quiet + 1 : 0;
    if (quiet >= 2) break;
  }
  return total;
}
