"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientListItem } from "@/lib/peithoBackend";

// Versión compacta de AssignClientForm para usar dentro de una celda de
// MeetingsTable — permite asignar el cliente sin entrar al detalle de cada
// reunión, pensado para el flujo de "Sin cliente asignado": filtrar todas las
// que faltan y clasificarlas de corrido. Mismo endpoint (PUT
// /meetings/:id/client) y mismo criterio admin-only que el formulario grande.
export default function InlineClientSelect({
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

  async function handleChange(next: string) {
    setValue(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/client`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: next || null }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <select
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => handleChange(e.target.value)}
      disabled={saving}
      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white disabled:opacity-50"
    >
      <option value="">— Sin cliente —</option>
      {clients.map((client) => (
        <option key={client.id} value={client.id}>
          {client.name}
        </option>
      ))}
    </select>
  );
}
