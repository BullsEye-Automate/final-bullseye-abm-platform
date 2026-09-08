"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MeetingListItem } from "@/lib/peithoBackend";

const STATUS_LABEL: Record<MeetingListItem["status"], string> = {
  scheduled: "Agendada",
  captured: "Capturada",
  analyzed: "Analizada",
};

function formatDate(value: string | null): string {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function PuntajeBadge({ puntaje }: { puntaje: number | null | undefined }) {
  if (puntaje == null) return <span className="text-gray-300">—</span>;
  const [bg, color] =
    puntaje >= 8 ? ["#E6F6EE", "#1F8A5C"] : puntaje >= 5 ? ["#FBF1DF", "#B4740E"] : ["#FBE7E4", "#C0392B"];
  return (
    <span
      className="text-xs font-bold px-2.5 py-0.5 rounded-lg"
      style={{ background: bg, color }}
    >
      {puntaje}/10
    </span>
  );
}

// `detailBasePath` habilita el click-through a la página de detalle (ej.
// "/reuniones/pasadas") — se omite en páginas que todavía no tienen detalle
// (Módulo 1, pendiente).
// `showPuntaje` agrega la columna ordenable de desempeño del vendedor (solo
// tiene sentido en "Reuniones pasadas" — en futuras nunca hay análisis todavía).
export default function MeetingsTable({
  meetings,
  detailBasePath,
  showClientColumn = false,
  showPuntaje = false,
}: {
  meetings: MeetingListItem[];
  detailBasePath?: string;
  // Fase E — solo tiene sentido para admin (viendo varios clientes a la vez);
  // un usuario "client" ya sabe que todo lo que ve es suyo.
  showClientColumn?: boolean;
  showPuntaje?: boolean;
}) {
  const router = useRouter();
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);

  const sorted = useMemo(() => {
    if (!sortDir) return meetings;
    return [...meetings].sort((a, b) => {
      const av = a.puntaje ?? -1;
      const bv = b.puntaje ?? -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [meetings, sortDir]);

  function toggleSort() {
    setSortDir((prev) => (prev === "desc" ? "asc" : prev === "asc" ? null : "desc"));
  }

  if (meetings.length === 0) {
    return <p className="text-sm text-gray-500">No hay reuniones para mostrar todavía.</p>;
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
            <th className="px-4 py-3 font-medium">Fecha</th>
            <th className="px-4 py-3 font-medium">Ejecutivo</th>
            <th className="px-4 py-3 font-medium">Contraparte</th>
            <th className="px-4 py-3 font-medium">Empresa</th>
            {showClientColumn && <th className="px-4 py-3 font-medium">Cliente</th>}
            {showPuntaje && (
              <th className="px-4 py-3 font-medium">
                <button onClick={toggleSort} className="flex items-center gap-1 hover:text-gray-700">
                  Puntaje
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    style={{
                      transform: sortDir === "asc" ? "rotate(180deg)" : undefined,
                      opacity: sortDir ? 1 : 0.5,
                    }}
                  >
                    <polyline points="7 10 12 15 17 10" />
                  </svg>
                </button>
              </th>
            )}
            <th className="px-4 py-3 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((meeting) => (
            <tr
              key={meeting.id}
              onClick={detailBasePath ? () => router.push(`${detailBasePath}/${meeting.id}`) : undefined}
              className={`border-b border-gray-50 last:border-0 hover:bg-gray-50 ${
                detailBasePath ? "cursor-pointer" : ""
              }`}
            >
              <td className="px-4 py-3">{formatDate(meeting.start_time)}</td>
              <td className="px-4 py-3">{meeting.ejecutivo ?? "—"}</td>
              <td className="px-4 py-3">{meeting.contraparte ?? "—"}</td>
              <td className="px-4 py-3">{meeting.empresa_contraparte ?? "—"}</td>
              {showClientColumn && <td className="px-4 py-3">{meeting.cliente_bullseye ?? "—"}</td>}
              {showPuntaje && (
                <td className="px-4 py-3">
                  <PuntajeBadge puntaje={meeting.puntaje} />
                </td>
              )}
              <td className="px-4 py-3">{STATUS_LABEL[meeting.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
