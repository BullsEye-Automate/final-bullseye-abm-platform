"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Se usa cuando el research no encontró (o no está seguro de) el perfil de
// LinkedIn del contacto — ej. nombres homónimos. El ejecutivo pega la URL a
// mano y el próximo research la usa directo con web_fetch en vez de adivinar.
export default function LinkedinUrlForm({
  meetingId,
  initialUrl,
}: {
  meetingId: string;
  initialUrl: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/contacto-linkedin`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_url: value }),
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
        URL de LinkedIn del contacto (opcional — pégala si el research no encuentra el perfil correcto)
      </p>
      <div className="flex gap-2">
        <input
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://www.linkedin.com/in/..."
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2"
          style={{ ["--tw-ring-color" as string]: "#62E0D8" }}
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
          style={{ background: "#251762" }}
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
