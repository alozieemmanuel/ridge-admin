"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";

interface AdminRow {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN";
  createdAt: string;
  lastLoginAt: string | null;
}

export default function AdminsPage() {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"OWNER" | "ADMIN">("ADMIN");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const [adminsRes, meRes] = await Promise.all([
      fetch("/api/admin/admins"),
      fetch("/api/admin/me"),
    ]);
    if (adminsRes.ok) {
      const data = await adminsRes.json();
      setAdmins(data.admins);
    }
    if (meRes.ok) {
      const data = await meRes.json();
      setCurrentAdminId(data.admin.adminId);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    const res = await fetch("/api/admin/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role }),
    });

    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFormError(data.error || "Failed to create admin.");
      return;
    }

    setName("");
    setEmail("");
    setPassword("");
    setRole("ADMIN");
    load();
  }

  async function handleRemove(id: string) {
    if (!confirm("Remove this admin's access?")) return;
    const res = await fetch(`/api/admin/admins/${id}`, { method: "DELETE" });
    if (res.ok) {
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to remove admin.");
    }
  }

  return (
    <AdminShell active="/admin/admins">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">Manage Admins</h2>
        <p className="text-muted text-sm mt-1">Only owners can add or remove admin accounts.</p>
      </div>

      <div className="border border-border rounded-xl overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-border">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Last Login</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading &&
              admins.map((a) => (
                <tr key={a.id} className="border-b border-border/50 last:border-b-0">
                  <td className="px-5 py-4">{a.name}</td>
                  <td className="px-5 py-4 text-muted">{a.email}</td>
                  <td className="px-5 py-4">
                    <span className="px-2.5 py-1 rounded-full border border-border text-xs">
                      {a.role}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-muted">
                    {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : "Never"}
                  </td>
                  <td className="px-5 py-4 text-right">
                    {a.id !== currentAdminId && (
                      <button
                        onClick={() => handleRemove(a.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="border border-border rounded-xl p-6 max-w-lg">
        <h3 className="text-gold text-sm font-semibold mb-4">Add Admin</h3>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-2">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-black/30 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-2">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-black/30 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-2">
              Temporary Password
            </label>
            <input
              type="password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/30 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-2">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "OWNER" | "ADMIN")}
              className="w-full bg-black/30 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold"
            >
              <option value="ADMIN">Admin</option>
              <option value="OWNER">Owner</option>
            </select>
          </div>

          {formError && <p className="text-sm text-red-400">{formError}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="text-sm px-5 py-2.5 rounded-full bg-gradient-to-br from-goldlight via-gold to-golddark text-black font-semibold uppercase tracking-widest disabled:opacity-60"
          >
            {submitting ? "Adding…" : "Add Admin"}
          </button>
        </form>
      </div>
    </AdminShell>
  );
}
