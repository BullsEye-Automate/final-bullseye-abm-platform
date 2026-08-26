"use client";

import { useMemo, useState } from "react";
import { IconX, IconArrowUp, IconArrowDown } from "@tabler/icons-react";

interface Reunion {
  id: string;
  sdr_nombre: string;
  fecha_reunion: string;
  fecha_agendamiento?: string;
  prospecto_nombre?: string;
  empresa?: string;
  client_name?: string;
}

type SortKey = "sdr_nombre" | "client_name" | "prospecto_nombre" | "empresa" | "fecha_agendamiento" | "fecha_reunion";
type SortDir = "asc" | "desc";

interface ModalReunionesProps {
  isOpen: boolean;
  fecha: string;
  reuniones: Reunion[];
  onClose: () => void;
}

// fecha_reunion / fecha_agendamiento son columnas DATE (sin hora) — se
// formatean anclando a UTC explícitamente para no correr el día al
// formatear en el navegador (misma causa que el desfase visto en otras
// partes del módulo: new Date("YYYY-MM-DD") es medianoche UTC, y sin
// timeZone:"UTC" se lee en hora local).
function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "N/A";
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function ModalReuniones({ isOpen, fecha, reuniones, onClose }: ModalReunionesProps) {
  const [sortKey, setSortKey] = useState<SortKey>("sdr_nombre");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sortedReuniones = useMemo(() => {
    return [...reuniones].sort((a, b) => {
      const aVal = a[sortKey] || "";
      const bVal = b[sortKey] || "";
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }, [reuniones, sortKey, sortDir]);

  if (!isOpen) return null;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <span className="text-gray-300 ml-1">↕</span>;
    return sortDir === "asc" ? (
      <IconArrowUp size={12} className="inline ml-1" />
    ) : (
      <IconArrowDown size={12} className="inline ml-1" />
    );
  };

  const COLUMNS: { key: SortKey; label: string }[] = [
    { key: "sdr_nombre", label: "SDR" },
    { key: "client_name", label: "Cliente" },
    { key: "prospecto_nombre", label: "Prospecto" },
    { key: "empresa", label: "Empresa" },
    { key: "fecha_agendamiento", label: "Fecha de agendamiento" },
    { key: "fecha_reunion", label: "Fecha de reunión" },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 p-6 border-b shrink-0">
          <div>
            <h2 className="font-semibold text-lg">Reuniones Agendadas</h2>
            <p className="text-sm text-ink-muted">{fecha}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition"
          >
            <IconX size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-auto flex-1">
          {reuniones.length === 0 ? (
            <p className="text-center text-ink-muted py-8">No hay reuniones para este día</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                    >
                      <button onClick={() => toggleSort(col.key)} className="flex items-center">
                        {col.label}
                        <SortIcon column={col.key} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedReuniones.map((reunion, idx) => (
                  <tr key={reunion.id} className={idx % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"}>
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{reunion.sdr_nombre}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{reunion.client_name || "N/A"}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{reunion.prospecto_nombre || "N/A"}</td>
                    <td className="px-4 py-3 text-gray-700">{reunion.empresa || "N/A"}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(reunion.fecha_agendamiento)}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(reunion.fecha_reunion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
