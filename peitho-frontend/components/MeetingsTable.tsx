"use client";

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

// `detailBasePath` habilita el click-through a la página de detalle (ej.
// "/reuniones/pasadas") — se omite en páginas que todavía no tienen detalle
// (Módulo 1, pendiente).
export default function MeetingsTable({
  meetings,
  detailBasePath,
}: {
  meetings: MeetingListItem[];
  detailBasePath?: string;
}) {
  const router = useRouter();

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
            <th className="px-4 py-3 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {meetings.map((meeting) => (
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
              <td className="px-4 py-3">{STATUS_LABEL[meeting.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
