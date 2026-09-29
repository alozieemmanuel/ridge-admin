"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import TemplatePicker, { type TemplateInfo } from "@/components/TemplatePicker";
import { useAutoRefresh } from "@/lib/useAutoRefresh";

interface ConversationRow {
  id: string;
  waId: string;
  name: string | null;
  kind: "registration" | "prospect" | null;
  unreadCount: number;
  lastMessageAt: string;
  windowOpen: boolean;
  lastMessage: { direction: "INBOUND" | "OUTBOUND"; body: string | null; status: string } | null;
}

interface Message {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  templateName: string | null;
  status: "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "RECEIVED";
  errorMessage: string | null;
  sentByName: string | null;
  isBroadcast: boolean;
  createdAt: string;
}

interface Thread {
  id: string;
  waId: string;
  name: string | null;
  kind: "registration" | "prospect" | null;
  windowOpen: boolean;
  windowClosesAt: string | null;
}

interface Contact {
  name: string;
  phone: string;
  kind: string;
}

const inputClass =
  "w-full bg-inputbg border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold";
const goldButton =
  "text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest disabled:opacity-50";
const ghostButton = "text-sm px-4 py-2.5 rounded-full border border-border text-muted hover:text-fg disabled:opacity-60";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function StatusTick({ status }: { status: Message["status"] }) {
  if (status === "FAILED") return <span className="text-red-400">Failed</span>;
  if (status === "READ") return <span className="text-emerald-400">Read</span>;
  if (status === "DELIVERED") return <span>Delivered</span>;
  if (status === "SENT") return <span>Sent</span>;
  return <span>Sending…</span>;
}

function WhatsAppInbox() {
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/whatsapp/conversations${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""}`);
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations);
      setConfigured(data.configured);
    } catch {
      // keep last data
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadThread = useCallback(async (id: string | null) => {
    if (!id) return;
    try {
      // Only mark as read while the admin is actually looking at the tab.
      const markRead = document.visibilityState === "visible" ? "1" : "0";
      const res = await fetch(`/api/admin/whatsapp/conversations/${id}/messages?markRead=${markRead}`);
      if (!res.ok) return;
      const data = await res.json();
      setThread(data.conversation);
      setMessages(data.messages);
    } catch {
      // keep last data
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(loadList, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadList, search]);

  useEffect(() => {
    setThread(null);
    setMessages([]);
    loadThread(activeId);
  }, [activeId, loadThread]);

  // New replies show up within a few seconds. This is polling, not a live socket, because the app runs on serverless hosting.
  useAutoRefresh(() => loadList(), 6_000);
  useAutoRefresh(() => loadThread(activeId), 4_000);

  // Arriving from the Prospects page: /admin/whatsapp?to=<phone>&name=<name>
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    const to = searchParams.get("to");
    if (!to || startedFor.current === to) return;
    startedFor.current = to;
    startChat(to, searchParams.get("name") ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function startChat(phone: string, name?: string) {
    setError(null);
    const res = await fetch("/api/admin/whatsapp/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Couldn't start the chat.");
      return;
    }
    setShowNew(false);
    await loadList();
    setActiveId(data.id);
  }

  return (
    <AdminShell active="/admin/whatsapp">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-serif text-2xl">WhatsApp</h2>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Message people one to one and see their replies as they arrive. To message everyone at once, use
            Campaigns &gt; WhatsApp.
          </p>
        </div>
        <button onClick={() => setShowNew(true)} className={goldButton}>
          New chat
        </button>
      </div>

      {!configured && (
        <div className="border border-amber-400/40 rounded-xl p-4 mb-6 text-sm">
          <p className="text-amber-300 mb-1">WhatsApp isn&apos;t connected on the server yet.</p>
          <p className="text-muted">
            Add <code>WHATSAPP_ACCESS_TOKEN</code>, <code>WHATSAPP_PHONE_NUMBER_ID</code> and{" "}
            <code>WHATSAPP_BUSINESS_ACCOUNT_ID</code>, then point Meta&apos;s webhook to{" "}
            <code>/api/webhooks/whatsapp</code>. Messages you send until then are saved as failed.
          </p>
        </div>
      )}
      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <div className="grid md:grid-cols-[20rem_1fr] border border-border rounded-xl overflow-hidden min-h-[32rem]">
        <div className="border-b md:border-b-0 md:border-r border-border flex flex-col max-h-[70vh]">
          <div className="p-3 border-b border-border">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or number" className={inputClass} />
          </div>
          <div className="overflow-y-auto flex-1">
            {loading && <p className="p-4 text-sm text-muted">Loading…</p>}
            {!loading && conversations.length === 0 && (
              <p className="p-4 text-sm text-muted">{search ? "No chats match." : "No chats yet. Start one with New chat."}</p>
            )}
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-border/50 transition-colors ${activeId === c.id ? "bg-gold/10" : "hover:bg-gold/5"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{c.name ?? `+${c.waId}`}</span>
                  <span className="text-xs text-muted whitespace-nowrap">{timeLabel(c.lastMessageAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-xs text-muted truncate">
                    {c.lastMessage ? `${c.lastMessage.direction === "OUTBOUND" ? "You: " : ""}${c.lastMessage.body ?? ""}` : "No messages"}
                  </span>
                  {c.unreadCount > 0 && (
                    <span className="text-xs rounded-full bg-gold text-black font-semibold px-2 py-0.5">{c.unreadCount}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col max-h-[70vh]">
          {!activeId && <div className="flex-1 flex items-center justify-center text-muted text-sm p-8">Pick a chat, or start a new one.</div>}
          {activeId && (
            <ChatPane
              key={activeId}
              conversationId={activeId}
              thread={thread}
              messages={messages}
              onSent={() => {
                loadThread(activeId);
                loadList();
              }}
            />
          )}
        </div>
      </div>

      {showNew && <NewChatDialog onClose={() => setShowNew(false)} onStart={startChat} />}
    </AdminShell>
  );
}

function ChatPane({
  conversationId,
  thread,
  messages,
  onSent,
}: {
  conversationId: string;
  thread: Thread | null;
  messages: Message[];
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<{ template: TemplateInfo | null; params: string[]; ready: boolean }>({ template: null, params: [], ready: false });
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  useEffect(() => {
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  async function post(payload: object) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/whatsapp/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Failed to send.");
      else setText("");
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setSending(false);
      onSent();
    }
  }

  const windowOpen = thread?.windowOpen ?? false;

  return (
    <>
      <div className="px-5 py-4 border-b border-border">
        <div className="font-medium">{thread?.name ?? (thread ? `+${thread.waId}` : "…")}</div>
        {thread && (
          <div className="text-xs text-muted mt-0.5">
            +{thread.waId}
            {thread.kind === "registration" && " · Registered"}
            {thread.kind === "prospect" && " · Prospect"}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
        {messages.map((m) => {
          const mine = m.direction === "OUTBOUND";
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${mine ? "bg-gold/15 border border-gold/30" : "border border-border"}`}>
                {m.type === "template" && (
                  <div className="text-xs text-muted mb-1">
                    Template{m.templateName ? `: ${m.templateName}` : ""}
                    {m.isBroadcast ? " (broadcast)" : ""}
                  </div>
                )}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <div className="text-[11px] text-muted mt-1 flex gap-2 justify-end">
                  {mine && m.sentByName && <span>{m.sentByName}</span>}
                  <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  {mine && <StatusTick status={m.status} />}
                </div>
                {m.status === "FAILED" && m.errorMessage && <p className="text-xs text-red-400 mt-1">{m.errorMessage}</p>}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-4">
        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        {windowOpen ? (
          <div className="flex gap-3 items-end">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && text.trim() && !sending) {
                  e.preventDefault();
                  post({ type: "text", body: text });
                }
              }}
              rows={2}
              placeholder="Type a reply. Enter sends, Shift+Enter adds a line."
              className={inputClass}
            />
            <button onClick={() => post({ type: "text", body: text })} disabled={sending || !text.trim()} className={goldButton}>
              {sending ? "…" : "Send"}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-xs text-muted mb-3">
              WhatsApp allows free-text replies only within 24 hours of the person&apos;s last message. Until they reply, send an approved template.
            </p>
            <TemplatePicker onChange={setPick} />
            <div className="mt-4">
              <button
                onClick={() => pick.template && post({ type: "template", templateName: pick.template.name, language: pick.template.language, params: pick.params })}
                disabled={sending || !pick.ready}
                className={goldButton}
              >
                {sending ? "Sending…" : "Send template"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function NewChatDialog({ onClose, onStart }: { onClose: () => void; onStart: (phone: string, name?: string) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setContacts([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/admin/whatsapp/contacts?q=${encodeURIComponent(query.trim())}`)
        .then((r) => (r.ok ? r.json() : { contacts: [] }))
        .then((d) => setContacts(d.contacts))
        .catch(() => setContacts([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const looksLikeNumber = query.replace(/\D/g, "").length >= 7;

  async function start(phone: string, name?: string) {
    setBusy(true);
    await onStart(phone, name);
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md bg-cardbg border border-border rounded-2xl p-6">
        <p className="text-xs uppercase tracking-wider text-muted mb-1">New chat</p>
        <h3 className="font-serif text-xl mb-5">Who do you want to message?</h3>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a registrant or prospect, or type a number"
          className={inputClass}
        />
        <div className="mt-3 max-h-64 overflow-y-auto">
          {contacts.map((c, i) => (
            <button
              key={`${c.phone}-${i}`}
              onClick={() => start(c.phone, c.name)}
              disabled={busy}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gold/10 text-sm"
            >
              <span className="font-medium">{c.name}</span>
              <span className="text-muted"> · {c.kind} · {c.phone}</span>
            </button>
          ))}
          {looksLikeNumber && (
            <button onClick={() => start(query)} disabled={busy} className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gold/10 text-sm text-goldlight">
              Message {query}
            </button>
          )}
        </div>
        <p className="text-xs text-muted mt-3">Numbers without a country code are treated as Nigerian numbers.</p>
        <div className="flex justify-end mt-5">
          <button onClick={onClose} className={ghostButton}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WhatsAppPage() {
  return (
    <Suspense fallback={null}>
      <WhatsAppInbox />
    </Suspense>
  );
}
