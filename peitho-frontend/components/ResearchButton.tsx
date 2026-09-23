"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PreBriefStatus } from "@/lib/peithoBackend";

// Mientras el research corre en el backend (búsqueda web + Claude, puede
// tardar 15-30s), hace polling liviano a la ruta proxy cada 4s. Al terminar,
// refresca el Server Component (router.refresh()) para traer el pre_brief ya
// guardado sin recargar toda la página.
// Tope de research que puede lanzar un rol "cliente" para la misma reunión
// (23-09-2026, pedido explícito del usuario — ahora se vende Peitho directo
// a los ejecutivos del cliente, así que hace falta un límite de costo). Debe
// calzar con MAX_CLIENT_RESEARCH_RUNS en routes/meetings.ts — un admin de
// BullsEye no tiene tope.
const MAX_CLIENT_RESEARCH_RUNS = 2;

export default function ResearchButton({
  meetingId,
  initialStatus,
  researchRunCount,
  isClient,
}: {
  meetingId: string;
  initialStatus: PreBriefStatus;
  researchRunCount: number;
  isClient: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<PreBriefStatus>(initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (status !== "running") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.pre_brief_status && data.pre_brief_status !== "running") {
          setStatus(data.pre_brief_status);
          router.refresh();
        }
      } catch {
        // red momentáneamente caída — el próximo tick reintenta, no hace falta manejarlo
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [status, meetingId, router]);

  async function handleClick() {
    setErrorMessage(null);
    setStatus("running");
    try {
      const res = await fetch(`/api/meetings/${meetingId}/research`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body.error ?? "No se pudo iniciar el research.");
        setStatus(initialStatus);
      }
    } catch {
      setErrorMessage("No se pudo iniciar el research — revisa tu conexión e intenta de nuevo.");
      setStatus(initialStatus);
    }
  }

  const limitReached = isClient && researchRunCount >= MAX_CLIENT_RESEARCH_RUNS;

  if (status === "running") {
    return (
      <button
        disabled
        className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-500 cursor-not-allowed"
      >
        Investigando…
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={limitReached}
        className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: "#251762" }}
      >
        {status === "failed" ? "Reintentar research" : status === "done" ? "Repetir research" : "Iniciar research"}
      </button>
      {isClient && !limitReached && (
        <p className="text-xs text-gray-400">
          Quedan {MAX_CLIENT_RESEARCH_RUNS - researchRunCount} de {MAX_CLIENT_RESEARCH_RUNS} intentos
        </p>
      )}
      {errorMessage && <p className="text-xs text-red-600 max-w-xs text-right">{errorMessage}</p>}
    </div>
  );
}
