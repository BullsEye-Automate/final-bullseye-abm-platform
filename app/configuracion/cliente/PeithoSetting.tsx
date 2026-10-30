"use client";

import { useEffect, useState } from "react";
import { IconLoader2, IconSparkles } from "@tabler/icons-react";

// "Incluir Peitho": Sí = el cliente paga el servicio y en Oportunidades →
// Peitho ve la app con el feedback automático de sus reuniones; No = ve la
// landing comercial para activarlo. Se guarda al cambiar.
export default function PeithoSetting({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(null);
    setError(null);
    fetch(`/api/clients/${clientId}/peitho`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setEnabled(!!j.enabled))
      .catch(() => setEnabled(false));
  }, [clientId]);

  async function change(next: boolean) {
    setSaving(true);
    setError(null);
    const r = await fetch(`/api/clients/${clientId}/peitho`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    const j = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return setError(j.error ?? "No se pudo guardar");
    setEnabled(next);
  }

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold flex items-center gap-2">
          <IconSparkles size={18} className="text-brand" /> Peitho — feedback automático de reuniones
        </h2>
        <p className="text-sm text-ink-muted mt-1">
          Marca &quot;Sí&quot; si {clientName} tiene contratado Peitho: en Oportunidades → Peitho verá el feedback automático de sus
          reuniones. Con &quot;No&quot; se muestra la página comercial para activarlo.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Incluir Peitho</span>
        {enabled === null ? (
          <IconLoader2 size={16} className="animate-spin text-ink-muted" />
        ) : (
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {([true, false] as const).map((v) => (
              <button
                key={String(v)}
                onClick={() => v !== enabled && change(v)}
                disabled={saving}
                className="px-4 py-1.5 transition disabled:opacity-60"
                style={v === enabled ? { background: "#251762", color: "#fff" } : { color: "#6B6884" }}
              >
                {v ? "Sí" : "No"}
              </button>
            ))}
          </div>
        )}
        {saving && <IconLoader2 size={15} className="animate-spin text-ink-muted" />}
      </div>
      {error && <p className="text-xs text-danger-fg">{error}</p>}
    </section>
  );
}
