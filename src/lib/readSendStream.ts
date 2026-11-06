import type { SendEvent, SendProgress } from "./sendProgress";

/**
 * Reads the streamed answer of the Mailchimp send route (one JSON object per line) and reports each progress step.
 * Resolves with the final result, or with ok = false and an error message. If the connection closes before a final line
 * arrives (the server ran out of time, or the network dropped), it says so instead of waiting forever.
 */
export async function readSendStream<T>(body: ReadableStream<Uint8Array>, onProgress: (p: SendProgress) => void): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: { ok: true; data: T } | { ok: false; error: string } | null = null;

  const handle = (line: string) => {
    if (!line.trim()) return;
    let event: SendEvent;
    try {
      event = JSON.parse(line) as SendEvent;
    } catch {
      return;
    }
    if (event.type === "progress") onProgress(event.progress);
    else if (event.type === "done") final = { ok: true, data: event.result as T };
    else if (event.type === "error") final = { ok: false, error: event.error };
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
      }
      if (done) break;
    }
    handle(buffer);
  } catch {
    // fall through to the message below
  }
  return (
    final ?? {
      ok: false,
      error: "The connection closed before the send finished, so it is not known whether the email went out. Look under Sent campaigns before trying again.",
    }
  );
}
