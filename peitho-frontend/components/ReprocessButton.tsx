"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_POLL_ATTEMPTS = 20; // 20 x 4s = ~80s antes de avisar que puede haber fallado

// Botón de recuperación manual — solo se muestra (ver reuniones/[id]/page.tsx)
// cuando la reunión tiene un bot de Recall (recall_bot_available) y todavía no
// llegó a 'analyzed'. Cubre dos casos reales distintos con el mismo botón:
// (a) status='scheduled' — el webhook nunca guardó nada (ej. el OOM del
// respaldo de video, 08-09-2026); reprocesar vuelve a bajar audio+transcript
// y dispara el análisis. (b) status='captured' — el audio SÍ se guardó pero
// el análisis falló (ej. el bug real de CodersLab/Camila Ormeño, 09-09-2026:
// max_tokens=4096 no alcanzaba y Claude cortaba el JSON a medias); reprocesar
// vuelve a descargar todo (barato, no rompe nada) y reintenta el análisis con
// el fix ya aplicado. Se guarda el status de arranque en un ref (no en el
// prop, que no cambia hasta el refresh) para poder detectar "terminó" sea
// cual sea el estado inicial, en vez de asumir 'scheduled' a mano.
export default function ReprocessButton({ meetingId, status }: { meetingId: string; status: string }) {
  const router = useRouter();
  const [reprocessing, setReprocessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startStatusRef = useRef(status);
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!reprocessing) return;

    const interval = setInterval(async () => {
      attemptsRef.current += 1;
      try {
        const res = await fetch(`/api/meetings/${meetingId}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data.status && data.status !== startStatusRef.current) {
            setReprocessing(false);
            router.refresh();
            return;
          }
        }
      } catch {
        // red momentáneamente caída — el próximo tick reintenta, no hace falta manejarlo
      }

      if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
        setReprocessing(false);
        setError("Sigue igual después de un minuto largo — puede haber fallado de nuevo, revisá los logs del backend.");
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [reprocessing, meetingId, router]);

  if (status === "analyzed") return null;

  async function handleClick() {
    startStatusRef.current = status;
    attemptsRef.current = 0;
    setReprocessing(true);
    setError(null);
    const res = await fetch(`/api/meetings/${meetingId}/reprocess`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "No se pudo iniciar el reprocesamiento");
      setReprocessing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={reprocessing}
        className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 transition disabled:opacity-50"
      >
        {reprocessing ? "Reprocesando…" : status === "scheduled" ? "Reprocesar grabación" : "Reintentar análisis"}
      </button>
      {error && <p className="text-xs text-red-600 max-w-xs text-right">{error}</p>}
    </div>
  );
}
