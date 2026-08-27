"use client";

import { useMemo, useState } from "react";
import { IconArrowUp, IconArrowDown, IconMaximize, IconX } from "@tabler/icons-react";

interface PaisMetrics {
  pais_key: string;
  pais_nombre: string;
  llamadas_realizadas: number;
  llamadas_conectadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
  reuniones_pendientes: number;
  tasa_conectadas_por_contacto: number;
  tasa_agendada_por_conectada: number;
  tasa_realizacion_reuniones: number;
}

type SortKey = keyof PaisMetrics;
type SortDir = "asc" | "desc";

interface TablaRankingPaisProps {
  data: PaisMetrics[];
}

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
      llamadas_realizadas: sum("llamadas_realizadas"),
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
            <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50">
              <button onClick={() => toggleSort("pais_nombre")} className="flex items-center">
                País
                <SortIcon column="pais_nombre" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50">
              <button onClick={() => toggleSort("llamadas_realizadas")} className="flex items-center justify-end w-full">
                Llamadas
                <SortIcon column="llamadas_realizadas" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50">
              <button onClick={() => toggleSort("llamadas_conectadas")} className="flex items-center justify-end w-full">
                Llamadas Conectadas
                <SortIcon column="llamadas_conectadas" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50">
              <button onClick={() => toggleSort("reuniones_agendadas")} className="flex items-center justify-end w-full">
                Reuniones Agendadas
                <SortIcon column="reuniones_agendadas" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50">
              <button onClick={() => toggleSort("reuniones_realizadas")} className="flex items-center justify-end w-full">
                Reuniones Realizadas
                <SortIcon column="reuniones_realizadas" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50">
              <button onClick={() => toggleSort("reuniones_pendientes")} className="flex items-center justify-end w-full">
                Reuniones Pendientes
                <SortIcon column="reuniones_pendientes" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50">
              <button onClick={() => toggleSort("tasa_conectadas_por_contacto")} className="flex items-center justify-end w-full">
                Tasa Conectadas/Contacto
                <SortIcon column="tasa_conectadas_por_contacto" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50">
              <button onClick={() => toggleSort("tasa_agendada_por_conectada")} className="flex items-center justify-end w-full">
                Tasa Agendada/Conectada
                <SortIcon column="tasa_agendada_por_conectada" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50">
              <button onClick={() => toggleSort("tasa_realizacion_reuniones")} className="flex items-center justify-end w-full">
                Tasa Realización
                <SortIcon column="tasa_realizacion_reuniones" />
              </button>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sortedData.map((pais, idx) => (
            <tr key={pais.pais_key} className={idx % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"}>
              <td className="px-4 py-3 font-medium text-gray-900">{pais.pais_nombre}</td>
              <td className="px-4 py-3 text-right text-gray-700">{pais.llamadas_realizadas}</td>
              <td className="px-4 py-3 text-right text-gray-700">{pais.llamadas_conectadas}</td>
              <td className="px-4 py-3 text-right text-gray-700">{pais.reuniones_agendadas}</td>
              <td className="px-4 py-3 text-right text-gray-700">{pais.reuniones_realizadas}</td>
              <td className="px-4 py-3 text-right text-gray-700">{pais.reuniones_pendientes}</td>
              <td className="px-4 py-3 text-right text-gray-600">
                {pais.tasa_conectadas_por_contacto.toFixed(1)}%
              </td>
              <td className="px-4 py-3 text-right text-gray-600">
                {pais.tasa_agendada_por_conectada.toFixed(1)}%
              </td>
              <td className="px-4 py-3 text-right text-gray-600">
                {pais.tasa_realizacion_reuniones.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold sticky bottom-0">
            <td className="px-4 py-3 text-gray-900">Total</td>
            <td className="px-4 py-3 text-right text-gray-900">{totals.llamadas_realizadas}</td>
            <td className="px-4 py-3 text-right text-gray-900">{totals.llamadas_conectadas}</td>
            <td className="px-4 py-3 text-right text-gray-900">{totals.reuniones_agendadas}</td>
            <td className="px-4 py-3 text-right text-gray-900">{totals.reuniones_realizadas}</td>
            <td className="px-4 py-3 text-right text-gray-900">{totals.reuniones_pendientes}</td>
            <td className="px-4 py-3 text-right text-gray-900">
              {totals.tasa_conectadas_por_contacto.toFixed(1)}%
            </td>
            <td className="px-4 py-3 text-right text-gray-900">
              {totals.tasa_agendada_por_conectada.toFixed(1)}%
            </td>
            <td className="px-4 py-3 text-right text-gray-900">
              {totals.tasa_realizacion_reuniones.toFixed(1)}%
            </td>
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
