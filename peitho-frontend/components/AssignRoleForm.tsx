"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientListItem } from "@/lib/peithoBackend";

export default function AssignRoleForm({ clients }: { clients: ClientListItem[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "client">("client");
  const [clientId, setClientId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || (role === "client" && !clientId)) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/user-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role, clientId: role === "client" ? clientId : null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo asignar el rol");
        return;
      }
      setEmail("");
      setClientId("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-start">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="email@ejemplo.com"
        className="flex-1 min-w-[200px] text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
        style={{ ["--tw-ring-color" as string]: "#62E0D8" }}
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as "admin" | "client")}
        className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
      >
        <option value="client">Cliente</option>
        <option value="admin">Admin</option>
      </select>
      {role === "client" && (
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">Selecciona un cliente…</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="submit"
        disabled={saving || !email.trim() || (role === "client" && !clientId)}
        className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
        style={{ background: "#251762" }}
      >
        {saving ? "Asignando…" : "Asignar acceso"}
      </button>
      {error && <p className="text-xs text-red-600 w-full">{error}</p>}
    </form>
  );
}
