"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientExecutive } from "@/lib/peithoBackend";

// Corrige a mano a qué ejecutivo del roster del cliente quedó vinculada esta
// reunión (23-09-2026, pedido explícito del usuario) — a diferencia de
// AssignClientForm/ManualContactForm (admin-only), esto lo puede usar
// CUALQUIER usuario "client" de esta empresa: el caso de uso es que el
// propio equipo del cliente corrija una reunión que el match automático
// dejó sin vincular o vinculó mal (ver matchClientExecutiveName en el
// backend).
export default function MeetingExecutiveSelect({
  meetingId,
  executives,
  initialExecutiveId,
}: {
  meetingId: string;
  executives: ClientExecutive[];
  initialExecutiveId: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialExecutiveId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: string) {
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/executive`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_executive_id: next || null }),
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
        Corregir ejecutivo (si el nombre del excel no calzó con nadie del roster, o está mal)
      </p>
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white disabled:opacity-50"
      >
        <option value="">Sin ejecutivo asignado</option>
        {executives.map((exec) => (
          <option key={exec.id} value={exec.id}>
            {exec.name}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
