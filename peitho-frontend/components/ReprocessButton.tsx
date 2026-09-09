"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Botón de recuperación manual — solo se muestra (ver reuniones/[id]/page.tsx)
// cuando la reunión ya tiene un bot de Recall (recall_bot_available) pero
// sigue en status='scheduled': el bot terminó de grabar pero el webhook de
// /webhooks/recall nunca llegó a guardar nada, típicamente porque el proceso
// se cayó a mitad de camino (ej. el OOM real del respaldo de video,
// 08-09-2026 — ver el comentario en webhooks.ts). Mismo patrón de polling que
// ResearchButton: refresca el Server Component apenas status deja de ser
// 'scheduled'.
export default function ReprocessButton({ meetingId, status }: { meetingId: string; status: string }) {
  const router = useRouter();
  const [reprocessing, setReprocessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reprocessing) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.status && data.status !== "scheduled") {
          setReprocessing(false);
          router.refresh();
        }
      } catch {
        // red momentáneamente caída — el próximo tick reintenta, no hace falta manejarlo
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [reprocessing, meetingId, router]);

  if (status !== "scheduled") return null;

  async function handleClick() {
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
        {reprocessing ? "Reprocesando…" : "Reprocesar grabación"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
