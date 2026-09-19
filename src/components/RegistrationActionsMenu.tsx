"use client";

import { useEffect, useRef, useState } from "react";

export type RegistrationAction = "resend_confirmation" | "send_seat_invite" | "send_payment_reminder";

/** Calls the admin email action for one registration and returns a message to show. */
export async function runRegistrationAction(
  id: string,
  action: RegistrationAction
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`/api/admin/registrations/${id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) return { ok: true, message: "Sent." };
    const data = await res.json().catch(() => ({}));
    return { ok: false, message: data.error || `Failed to send (${res.status}).` };
  } catch {
    return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
  }
}

interface Props {
  paymentStatus: "NOT_PAID" | "PARTIAL" | "PAID";
  seatInviteSentAt: string | null;
  onAction: (action: RegistrationAction) => void;
  /** Pass only for owners; renders a destructive "Delete registration" item. */
  onDelete?: () => void;
}

const MENU_WIDTH = 240;
const MENU_HEIGHT_ESTIMATE = 190;

export default function RegistrationActionsMenu({ paymentStatus, seatInviteSentAt, onAction, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number }>({ right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The tables scroll inside an overflow container, which would clip an
  // absolutely-positioned dropdown — so the menu is fixed to the viewport
  // and placed relative to the button (flipping upward near the bottom).
  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const right = Math.max(8, window.innerWidth - rect.right);
      const flipUp = window.innerHeight - rect.bottom < MENU_HEIGHT_ESTIMATE;
      setPos(flipUp ? { right, bottom: window.innerHeight - rect.top + 8 } : { right, top: rect.bottom + 8 });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const seatDisabled = paymentStatus !== "PAID";
  const reminderDisabled = paymentStatus === "PAID";

  function choose(action: RegistrationAction) {
    setOpen(false);
    onAction(action);
  }

  const itemClass = "w-full text-left px-4 py-3 text-sm border-b border-border/50 disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-gold/10";

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggle}
        className="w-8 h-8 rounded-full border border-border text-muted hover:text-fg hover:border-gold flex items-center justify-center"
        aria-label="Row actions"
        aria-expanded={open}
      >
        ⋯
      </button>
      {open && (
        <div
          ref={menuRef}
          style={{ position: "fixed", width: MENU_WIDTH, ...pos }}
          className="bg-cardbg border border-border rounded-xl shadow-xl z-50 overflow-hidden"
        >
          <button onClick={() => choose("resend_confirmation")} className={itemClass}>
            Resend confirmation email
          </button>
          <button
            onClick={() => choose("send_seat_invite")}
            disabled={seatDisabled}
            title={seatDisabled ? "Available once payment is marked as fully paid" : undefined}
            className={itemClass}
          >
            {seatInviteSentAt ? "Resend seat-selection invite" : "Send seat-selection invite"}
            {seatDisabled && <span className="block text-xs text-muted mt-0.5">Once fully paid</span>}
          </button>
          <button
            onClick={() => choose("send_payment_reminder")}
            disabled={reminderDisabled}
            title={reminderDisabled ? "Already fully paid" : undefined}
            className={`${itemClass} ${onDelete ? "" : "border-b-0"}`}
          >
            Send payment reminder
            {reminderDisabled && <span className="block text-xs text-muted mt-0.5">Already fully paid</span>}
          </button>
          {onDelete && (
            <button
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-red-500/10"
            >
              Delete registration…
            </button>
          )}
        </div>
      )}
    </>
  );
}
