"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PreBriefStatus } from "@/lib/peithoBackend";

// Mientras el research corre en el backend (búsqueda web + Claude, puede
// tardar 15-30s), hace polling liviano a la ruta proxy cada 4s. Al terminar,
// refresca el Server Component (router.refresh()) para traer el pre_brief ya
// guardado sin recargar toda la página.
export default function ResearchButton({
  meetingId,
  initialStatus,
}: {
  meetingId: string;
  initialStatus: PreBriefStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<PreBriefStatus>(initialStatus);

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
    setStatus("running");
    await fetch(`/api/meetings/${meetingId}/research`, { method: "POST" });
  }

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
    <button
      onClick={handleClick}
      className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition"
      style={{ background: "#251762" }}
    >
      {status === "failed" ? "Reintentar research" : status === "done" ? "Repetir research" : "Iniciar research"}
    </button>
  );
}
