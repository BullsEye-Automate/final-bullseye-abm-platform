"use client";

import { useMemo, useState } from "react";
import { IconArrowUp, IconArrowDown } from "@tabler/icons-react";

interface SdrMetrics {
  sdr_id: string;
  sdr_nombre: string;
  llamadas_realizadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
  tasa_conectadas_por_contacto: number;
  tasa_agendada_por_conectada: number;
  tasa_realizacion_reuniones: number;
}

type SortKey = keyof SdrMetrics;
type SortDir = "asc" | "desc";

interface TablaRankingSdrProps {
  data: SdrMetrics[];
}

export default function TablaRankingSdr({ data }: TablaRankingSdrProps) {
  const [sortKey, setSortKey] = useState<SortKey>("reuniones_realizadas");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-100">
              <button onClick={() => toggleSort("sdr_nombre")} className="flex items-center">
                SDR
                <SortIcon column="sdr_nombre" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100">
              <button onClick={() => toggleSort("llamadas_realizadas")} className="flex items-center justify-end w-full">
                Llamadas
                <SortIcon column="llamadas_realizadas" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100">
              <button onClick={() => toggleSort("reuniones_agendadas")} className="flex items-center justify-end w-full">
                Reuniones Agendadas
                <SortIcon column="reuniones_agendadas" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100">
              <button onClick={() => toggleSort("reuniones_realizadas")} className="flex items-center justify-end w-full">
                Reuniones Realizadas
                <SortIcon column="reuniones_realizadas" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100">
              <button onClick={() => toggleSort("tasa_conectadas_por_contacto")} className="flex items-center justify-end w-full">
                Tasa Conectadas/Contacto
                <SortIcon column="tasa_conectadas_por_contacto" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100">
              <button onClick={() => toggleSort("tasa_agendada_por_conectada")} className="flex items-center justify-end w-full">
                Tasa Agendada/Conectada
                <SortIcon column="tasa_agendada_por_conectada" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100">
              <button onClick={() => toggleSort("tasa_realizacion_reuniones")} className="flex items-center justify-end w-full">
                Tasa Realización
                <SortIcon column="tasa_realizacion_reuniones" />
              </button>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sortedData.map((sdr, idx) => (
            <tr key={sdr.sdr_id} className={idx % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"}>
              <td className="px-4 py-3 font-medium text-gray-900">{sdr.sdr_nombre}</td>
              <td className="px-4 py-3 text-right text-gray-700">{sdr.llamadas_realizadas}</td>
              <td className="px-4 py-3 text-right text-gray-700">{sdr.reuniones_agendadas}</td>
              <td className="px-4 py-3 text-right text-gray-700">{sdr.reuniones_realizadas}</td>
              <td className="px-4 py-3 text-right text-gray-600">
                {sdr.tasa_conectadas_por_contacto.toFixed(1)}%
              </td>
              <td className="px-4 py-3 text-right text-gray-600">
                {sdr.tasa_agendada_por_conectada.toFixed(1)}%
              </td>
              <td className="px-4 py-3 text-right text-gray-600">
                {sdr.tasa_realizacion_reuniones.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
