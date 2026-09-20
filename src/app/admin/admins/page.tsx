"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { useAutoRefresh } from "@/lib/useAutoRefresh";

interface AdminRow {
  id: string;
  name: string;
  email: string;
  lastLoginAt: string | null;
  role?: "OWNER" | "ADMIN";
  archivedAt?: string | null;
}

type Dialog =
  | { kind: "edit"; admin: AdminRow }
  | { kind: "password"; admin: AdminRow }
  | null;

const inputClass =
  "w-full bg-black/30 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold";
const labelClass = "block text-xs uppercase tracking-wider text-muted mb-2";
const goldButton =
  "text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest disabled:opacity-60";
const ghostButton = "text-sm px-4 py-2.5 rounded-full border border-border text-muted hover:text-fg";

export default function ManageAdminsPage() {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

  function flash(text: string, ok: boolean) {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage({ text, ok });
    messageTimer.current = setTimeout(() => setMessage(null), ok ? 4000 : 8000);
  }

  const load = useCallback(async (silent = false) => {
    const mine = ++requestId.current;
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/admin/admins");
      if (res.ok && mine === requestId.current) {
        const data = await res.json();
        setAdmins(data.admins);
        setIsOwner(Boolean(data.isOwner));
      }
    } catch {
      // keep the last data; the next poll retries
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefresh(() => load(true), 30_000);

  async function patch(id: string, body: Record<string, unknown>, success: string) {
    const res = await fetch(`/api/admin/admins/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "That didn't work.");
    flash(success, true);
    load(true);
  }

  async function handleArchive(a: AdminRow) {
    if (!window.confirm(`Archive ${a.name}? They won't be able to sign in until you restore them.`)) return;
    try {
      await patch(a.id, { action: "archive" }, "Admin archived.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Failed.", false);
    }
  }

  async function handleRestore(a: AdminRow) {
    try {
      await patch(a.id, { action: "restore" }, "Admin restored.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Failed.", false);
    }
  }

  async function handleRemove(a: AdminRow) {
    if (!window.confirm(`Permanently remove ${a.name} (${a.email})? This cannot be undone. Archive them instead if you may need them back.`)) {
      return;
    }
    const res = await fetch(`/api/admin/admins/${a.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      flash("Admin removed.", true);
      load(true);
    } else {
      flash(data.error || "Failed to remove.", false);
    }
  }

  const visible = isOwner && !showArchived ? admins.filter((a) => !a.archivedAt) : admins;
  const archivedCount = admins.filter((a) => a.archivedAt).length;

  return (
    <AdminShell active="/admin/admins">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">{isOwner ? "Manage Admins" : "Team"}</h2>
        <p className="text-muted text-sm mt-1">
          {isOwner ? "Only owners can add, edit, archive or remove admin accounts." : "The people who have access to this dashboard."}
          {message && <span className={`ml-3 ${message.ok ? "text-goldlight" : "text-red-400"}`}>{message.text}</span>}
        </p>
      </div>

      {isOwner && archivedCount > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={`text-sm px-4 py-2 rounded-full border transition-colors ${
              showArchived ? "border-gold text-goldlight bg-gold/10" : "border-border text-muted"
            }`}
          >
            {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
          </button>
        </div>
      )}

      <div className="border border-border rounded-xl overflow-hidden mb-10">
        <div className="table-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
                <th className="px-6 py-4 font-medium whitespace-nowrap">Name</th>
                <th className="px-6 py-4 font-medium whitespace-nowrap">Email</th>
                {isOwner && <th className="px-6 py-4 font-medium whitespace-nowrap">Role</th>}
                <th className="px-6 py-4 font-medium whitespace-nowrap">Last login</th>
                {isOwner && <th className="px-6 py-4 font-medium whitespace-nowrap"></th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={isOwner ? 5 : 3} className="px-6 py-8 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading &&
                visible.map((a) => (
                  <tr key={a.id} className={`border-b border-border/50 last:border-b-0 ${a.archivedAt ? "opacity-60" : ""}`}>
                    <td className="px-6 py-5 whitespace-nowrap font-medium">
                      {a.name}
                      {a.archivedAt && (
                        <span className="ml-2 text-xs rounded-full border border-border px-2 py-0.5 text-muted">Archived</span>
                      )}
                    </td>
                    <td className="px-6 py-5 text-muted whitespace-nowrap">{a.email}</td>
                    {isOwner && (
                      <td className="px-6 py-5 whitespace-nowrap">
                        <span className="px-2.5 py-1 rounded-full border border-border text-xs uppercase">{a.role}</span>
                      </td>
                    )}
                    <td className="px-6 py-5 text-muted whitespace-nowrap">
                      {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : "Never"}
                    </td>
                    {isOwner && (
                      <td className="px-6 py-5 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-4 text-xs">
                          <button onClick={() => setDialog({ kind: "edit", admin: a })} className="text-goldlight hover:underline">
                            Edit
                          </button>
                          <button onClick={() => setDialog({ kind: "password", admin: a })} className="text-goldlight hover:underline">
                            Password
                          </button>
                          {a.archivedAt ? (
                            <button onClick={() => handleRestore(a)} className="text-emerald-300 hover:underline">
                              Restore
                            </button>
                          ) : (
                            <button onClick={() => handleArchive(a)} className="text-amber-300 hover:underline">
                              Archive
                            </button>
                          )}
                          <button onClick={() => handleRemove(a)} className="text-red-400 hover:underline">
                            Remove
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {isOwner && <AddAdminForm onAdded={() => { flash("Admin added.", true); load(true); }} onError={(m) => flash(m, false)} />}

      {dialog?.kind === "edit" && (
        <EditDialog
          admin={dialog.admin}
          onClose={() => setDialog(null)}
          onSave={async (values) => {
            await patch(dialog.admin.id, { action: "edit", ...values }, "Admin updated.");
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "password" && (
        <PasswordDialog
          admin={dialog.admin}
          onClose={() => setDialog(null)}
          onSave={async (password) => {
            await patch(dialog.admin.id, { action: "password", password }, "Password changed.");
            setDialog(null);
          }}
        />
      )}
    </AdminShell>
  );
}

function AddAdminForm({ onAdded, onError }: { onAdded: () => void; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "OWNER">("ADMIN");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to add admin.");
      setName("");
      setEmail("");
      setPassword("");
      setRole("ADMIN");
      onAdded();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add admin.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-border rounded-xl p-6 max-w-2xl">
      <h3 className="font-serif text-xl text-goldlight mb-5">Add Admin</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className={labelClass}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "OWNER")} className={inputClass}>
            <option value="ADMIN">Admin</option>
            <option value="OWNER">Owner</option>
          </select>
        </div>
      </div>
      <button onClick={handleSubmit} disabled={submitting || !name || !email || !password} className={`${goldButton} mt-6`}>
        {submitting ? "Adding…" : "Add admin"}
      </button>
    </div>
  );
}

function EditDialog({
  admin,
  onClose,
  onSave,
}: {
  admin: AdminRow;
  onClose: () => void;
  onSave: (values: { name: string; email: string; role: "OWNER" | "ADMIN" }) => Promise<void>;
}) {
  const [name, setName] = useState(admin.name);
  const [email, setEmail] = useState(admin.email);
  const [role, setRole] = useState<"OWNER" | "ADMIN">(admin.role ?? "ADMIN");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSave({ name, email, role });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md bg-cardbg border border-border rounded-2xl p-6">
        <p className="text-xs uppercase tracking-wider text-muted mb-1">Edit admin</p>
        <h3 className="font-serif text-xl mb-5">{admin.name}</h3>
        <label className={labelClass}>Name</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} mb-4`} />
        <label className={labelClass}>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputClass} mb-4`} />
        <label className={labelClass}>Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value as "OWNER" | "ADMIN")} className={inputClass}>
          <option value="ADMIN">Admin</option>
          <option value="OWNER">Owner</option>
        </select>
        {error && <p className="text-sm text-red-400 mt-4">{error}</p>}
        <div className="flex items-center justify-end gap-3 mt-6">
          <button onClick={onClose} disabled={submitting} className={ghostButton}>
            Cancel
          </button>
          <button onClick={submit} disabled={submitting || !name || !email} className={goldButton}>
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordDialog({
  admin,
  onClose,
  onSave,
}: {
  admin: AdminRow;
  onClose: () => void;
  onSave: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSave(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md bg-cardbg border border-border rounded-2xl p-6">
        <p className="text-xs uppercase tracking-wider text-muted mb-1">Change password</p>
        <h3 className="font-serif text-xl mb-5">{admin.name}</h3>
        <label className={labelClass}>New password</label>
        <input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} mb-4`} />
        <label className={labelClass}>Confirm password</label>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        <p className="text-xs text-muted mt-3">Share the new password with them privately. It isn&apos;t emailed.</p>
        {error && <p className="text-sm text-red-400 mt-4">{error}</p>}
        <div className="flex items-center justify-end gap-3 mt-6">
          <button onClick={onClose} disabled={submitting} className={ghostButton}>
            Cancel
          </button>
          <button onClick={submit} disabled={submitting || !password} className={goldButton}>
            {submitting ? "Saving…" : "Change password"}
          </button>
        </div>
      </div>
    </div>
  );
}