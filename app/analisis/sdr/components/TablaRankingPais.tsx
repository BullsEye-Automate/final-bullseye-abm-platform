"use client";

import { useMemo, useState } from "react";
import { IconArrowUp, IconArrowDown, IconMaximize, IconX } from "@tabler/icons-react";

interface PaisMetrics {
  pais_key: string;
  pais_nombre: string;
  contactos_gestionados: number;
  llamadas_realizadas: number;
  contactos_conectados: number;
  llamadas_conectadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
  reuniones_pendientes: number;
  tasa_conectadas_por_contacto: number;
  tasa_agendada_por_conectada: number;
  tasa_realizacion_reuniones: number;
}

type SortKey = keyof PaisMetrics;
type NumericKey = Exclude<SortKey, "pais_key" | "pais_nombre">;
type SortDir = "asc" | "desc";

interface TablaRankingPaisProps {
  data: PaisMetrics[];
}

const COLUMNS: { key: NumericKey; label: string; description: string }[] = [
  {
    key: "contactos_gestionados",
    label: "Contactos Gestionados",
    description: "Teléfonos distintos marcados en el período, sin importar si se conectaron o no.",
  },
  {
    key: "llamadas_realizadas",
    label: "Llamadas",
    description: "Total de llamadas salientes realizadas en el período (pueden repetirse por contacto).",
  },
  {
    key: "contactos_conectados",
    label: "Contactos Conectados",
    description: "Teléfonos distintos con al menos una llamada conectada (contestada o transferida, de 60 segundos o más).",
  },
  {
    key: "llamadas_conectadas",
    label: "Llamadas Conectadas",
    description: "Llamadas contestadas o transferidas que duraron 60 segundos o más.",
  },
  {
    key: "reuniones_agendadas",
    label: "Reuniones Agendadas",
    description: "Reuniones cuya fecha de reunión cae dentro del período, sin importar su estado.",
  },
  {
    key: "reuniones_realizadas",
    label: "Reuniones Realizadas",
    description: "De las reuniones con fecha en el período, las que quedaron marcadas como \"Sí\" (se realizaron).",
  },
  {
    key: "reuniones_pendientes",
    label: "Reuniones Pendientes",
    description: "De las reuniones con fecha en el período, las que siguen marcadas como \"Pendiente\".",
  },
  {
    key: "tasa_conectadas_por_contacto",
    label: "Contactos Conectados/Gestionados",
    description: "Contactos Conectados ÷ Contactos Gestionados — de los teléfonos marcados, a qué porcentaje se logró conectar.",
  },
  {
    key: "tasa_agendada_por_conectada",
    label: "Tasa Agendada/Conectada",
    description: "Reuniones Agendadas ÷ Contactos Conectados — de los contactos conectados, qué porcentaje terminó en una reunión agendada.",
  },
  {
    key: "tasa_realizacion_reuniones",
    label: "Tasa Realización",
    description: "Reuniones Realizadas ÷ Reuniones Agendadas.",
  },
];

const PERCENT_KEYS = new Set<NumericKey>([
  "tasa_conectadas_por_contacto",
  "tasa_agendada_por_conectada",
  "tasa_realizacion_reuniones",
]);

export default function TablaRankingPais({ data }: TablaRankingPaisProps) {
  const [sortKey, setSortKey] = useState<SortKey>("reuniones_realizadas");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      if (typeof aVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal);
      }

      const numA = aVal as number;
      const numB = bVal as number;
      return sortDir === "asc" ? numA - numB : numB - numA;
    });

    return sorted;
  }, [data, sortKey, sortDir]);

  const totals = useMemo(() => {
    const count = data.length || 1;
    const sum = (key: keyof PaisMetrics) => data.reduce((acc, pais) => acc + (pais[key] as number), 0);
    return {
      contactos_gestionados: sum("contactos_gestionados"),
      llamadas_realizadas: sum("llamadas_realizadas"),
      contactos_conectados: sum("contactos_conectados"),
      llamadas_conectadas: sum("llamadas_conectadas"),
      reuniones_agendadas: sum("reuniones_agendadas"),
      reuniones_realizadas: sum("reuniones_realizadas"),
      reuniones_pendientes: sum("reuniones_pendientes"),
      tasa_conectadas_por_contacto: sum("tasa_conectadas_por_contacto") / count,
      tasa_agendada_por_conectada: sum("tasa_agendada_por_conectada") / count,
      tasa_realizacion_reuniones: sum("tasa_realizacion_reuniones") / count,
    };
  }, [data]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <span className="text-gray-300 ml-1">↕</span>;
    return sortDir === "asc" ? (
      <IconArrowUp size={14} className="inline ml-1" />
    ) : (
      <IconArrowDown size={14} className="inline ml-1" />
    );
  };

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-ink-muted">
        No hay datos disponibles
      </div>
    );
  }

  const table = (
    <div className={isFullscreen ? "overflow-auto h-full" : "overflow-auto max-h-[600px]"}>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
          <tr>
            <th
              className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50"
              title="País del número de Allo usado en la llamada, o de la reunión (columna País del Excel)."
            >
              <button onClick={() => toggleSort("pais_nombre")} className="flex items-center">
                País
                <SortIcon column="pais_nombre" />
              </button>
            </th>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50"
                title={col.description}
              >
                <button onClick={() => toggleSort(col.key)} className="flex items-center justify-end w-full">
                  {col.label}
                  <SortIcon column={col.key} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sortedData.map((pais, idx) => (
            <tr key={pais.pais_key} className={idx % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"}>
              <td className="px-4 py-3 font-medium text-gray-900">{pais.pais_nombre}</td>
              {COLUMNS.map((col) => (
                <td key={col.key} className="px-4 py-3 text-right text-gray-700">
                  {PERCENT_KEYS.has(col.key) ? `${(pais[col.key] as number).toFixed(1)}%` : pais[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold sticky bottom-0">
            <td className="px-4 py-3 text-gray-900">Total</td>
            {COLUMNS.map((col) => (
              <td key={col.key} className="px-4 py-3 text-right text-gray-900">
                {PERCENT_KEYS.has(col.key) ? `${totals[col.key].toFixed(1)}%` : totals[col.key]}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
          <h2 className="font-semibold text-gray-900">Ranking País</h2>
          <button
            onClick={() => setIsFullscreen(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition"
          >
            <IconX size={16} />
            Cerrar
          </button>
        </div>
        <div className="flex-1 min-h-0">{table}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          onClick={() => setIsFullscreen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-100 border border-gray-200 transition"
        >
          <IconMaximize size={14} />
          Ver en pantalla completa
        </button>
      </div>
      {table}
    </div>
  );
}
