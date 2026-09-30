"use client";

import { useState } from "react";

// Pedido explícito del usuario (08-10-2026, reunión de Callegari
// Automotriz/OTIC CChC): una invitación al bot con un link de reunión válido
// igual no apareció en Peitho, y el truco de sacar/re-agregar a
// bot@peithob2b.com como invitado (que sirvió en un caso anterior) no
// funciona acá porque ella no es la dueña de esa cita — solo el organizador
// puede editar invitados. Este botón fuerza lo mismo desde el lado de
// Peitho: una resincronización COMPLETA del calendario del bot (no
// incremental), que reintenta absolutamente todos los eventos de los
// próximos 90 días, hayan cambiado o no desde la última vez.
export default function BotCalendarResyncButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/admin/calendar/bot-resync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo resincronizar");
        setStatus("error");
        return;
      }
      setStatus("done");
    } catch {
      setError("No se pudo conectar con el backend");
      setStatus("error");
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-2">
      <h2 className="text-sm font-semibold text-gray-900">Calendario del bot de Recall</h2>
      <p className="text-xs text-gray-500">
        Fuerza una resincronización completa del calendario de <code>bot@peithob2b.com</code> (los próximos 90 días,
        no solo lo que cambió desde la última vez) — usalo cuando una invitación al bot con link válido no aparece en
        "Reuniones futuras" y no podés sacar/volver a agregar al bot vos misma (porque no sos la dueña de esa cita).
      </p>
      <button
        onClick={handleClick}
        disabled={status === "loading"}
        className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
        style={{ background: "#251762" }}
      >
        {status === "loading" ? "Resincronizando…" : "Resincronizar calendario del bot"}
      </button>
      {status === "done" && (
        <p className="text-xs" style={{ color: "#1F8A5C" }}>
          Listo — se volvió a procesar todo el calendario. Si la reunión que faltaba tenía un problema real (no solo
          de sincronización), va a seguir sin aparecer — avisame y reviso los logs de Railway de este momento.
        </p>
      )}
      {status === "error" && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
