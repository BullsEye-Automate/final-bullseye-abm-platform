"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientListItem } from "@/lib/peithoBackend";

// Selector admin-only para corregir/asignar a mano el cliente de una
// reunión — cubre el caso de reuniones que se llevan un bot por invitación
// manual y no hicieron match con el excel de metas, o donde el match
// automático se equivocó (ver CLAUDE.md, Fase H).
export default function AssignClientForm({
  meetingId,
  clients,
  initialClientId,
}: {
  meetingId: string;
  clients: ClientListItem[];
  initialClientId: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialClientId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: string) {
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/client`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: next || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo guardar");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pt-2">
      <p className="text-xs font-medium text-gray-500 mb-1">
        Corregir cliente (solo si el match automático con el excel de metas está mal o falta)
      </p>
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white disabled:opacity-50"
      >
        <option value="">Sin cliente asignado</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
