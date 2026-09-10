"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_POLL_ATTEMPTS = 20; // 20 x 4s = ~80s antes de avisar que puede haber fallado

// Botón para recalcular el análisis de una reunión ya analizada, reusando el
// transcript_text ya guardado (sin volver a tocar Recall) — pedido explícito
// del usuario (10-09-2026) para reprocesar reuniones viejas cuando cambia el
// prompt/schema de análisis (ej. el Fit Score nuevo). Solo se muestra (ver
// reuniones/[id]/page.tsx) si la reunión tiene transcript_text.
//
// A diferencia de ReprocessButton, que detecta el fin del reprocesamiento
// por un cambio de `status`, acá el status ya es 'analyzed' antes y después
// — se compara `updated_at` en su lugar.
export default function ReanalyzeButton({ meetingId, updatedAt }: { meetingId: string; updatedAt?: string }) {
  const router = useRouter();
  const [reanalyzing, setReanalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startUpdatedAtRef = useRef(updatedAt);
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!reanalyzing) return;

    const interval = setInterval(async () => {
      attemptsRef.current += 1;
      try {
        const res = await fetch(`/api/meetings/${meetingId}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data.updated_at && data.updated_at !== startUpdatedAtRef.current) {
            setReanalyzing(false);
            router.refresh();
            return;
          }
        }
      } catch {
        // red momentáneamente caída — el próximo tick reintenta, no hace falta manejarlo
      }

      if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
        setReanalyzing(false);
        setError("Sigue igual después de un minuto largo — puede haber fallado, revisá los logs del backend.");
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [reanalyzing, meetingId, router]);

  async function handleClick() {
    startUpdatedAtRef.current = updatedAt;
    attemptsRef.current = 0;
    setReanalyzing(true);
    setError(null);
    const res = await fetch(`/api/meetings/${meetingId}/reanalyze`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "No se pudo iniciar el recálculo");
      setReanalyzing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={reanalyzing}
        className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 transition disabled:opacity-50"
      >
        {reanalyzing ? "Recalculando…" : "Recalcular análisis"}
      </button>
      {error && <p className="text-xs text-red-600 max-w-xs text-right">{error}</p>}
    </div>
  );
}
