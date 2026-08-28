"use client";

import { useMemo, useState } from "react";
import { IconArrowUp, IconArrowDown, IconMaximize, IconX } from "@tabler/icons-react";
import { SCORE_CARD_CATEGORIES } from "@/lib/callScoreCard";

export interface ScoreCallSummary {
  id: string;
  date: string;
  contact_number: string;
  contact_name: string | null;
  cliente_nombre: string;
  puntaje_total: number;
  nivel: string | null;
  desglose: Record<string, number | null>;
  has_recording: boolean;
  summary: string;
}

export interface SdrScoreMetrics {
  sdr_id: string;
  sdr_nombre: string;
  llamadas_analizadas: number;
  puntaje_total: number;
  desglose: Record<string, number | null>;
  calls: ScoreCallSummary[];
}

type SortKey = "sdr_nombre" | "llamadas_analizadas" | "puntaje_total" | string;
type SortDir = "asc" | "desc";

interface TablaScoresSdrProps {
  data: SdrScoreMetrics[];
  onCellClick: (row: SdrScoreMetrics, metricKey: string, metricLabel: string) => void;
}

const CATEGORY_LABELS = SCORE_CARD_CATEGORIES.map((c) => c.label);

function getValue(row: SdrScoreMetrics, key: SortKey): string | number {
  if (key === "sdr_nombre") return row.sdr_nombre;
  if (key === "llamadas_analizadas") return row.llamadas_analizadas;
  if (key === "puntaje_total") return row.puntaje_total;
  return row.desglose[key] ?? -1;
}

export default function TablaScoresSdr({ data, onCellClick }: TablaScoresSdrProps) {
  const [sortKey, setSortKey] = useState<SortKey>("puntaje_total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const va = getValue(a, sortKey);
      const vb = getValue(b, sortKey);
      if (typeof va === "string" || typeof vb === "string") {
        return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      }
      return sortDir === "asc" ? va - vb : vb - va;
    });
  }, [data, sortKey, sortDir]);

  const promedios = useMemo(() => {
    const count = data.length || 1;
    const puntajeTotal = data.reduce((acc, r) => acc + r.puntaje_total, 0) / count;
    const desglose: Record<string, number | null> = {};
    for (const label of CATEGORY_LABELS) {
      const withValue = data.filter((r) => r.desglose[label] != null);
      desglose[label] =
        withValue.length > 0 ? withValue.reduce((acc, r) => acc + (r.desglose[label] as number), 0) / withValue.length : null;
    }
    const llamadasAnalizadas = data.reduce((acc, r) => acc + r.llamadas_analizadas, 0);
    return { puntajeTotal, desglose, llamadasAnalizadas };
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
        No hay llamadas con análisis de IA para este período/filtro
      </div>
    );
  }

  const fmt = (v: number | null, max?: number) => (v == null ? "—" : max ? `${v.toFixed(1)}/${max}` : v.toFixed(1));

  const table = (
    <div className={isFullscreen ? "overflow-auto h-full" : "overflow-auto max-h-[600px]"}>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50">
              <button onClick={() => toggleSort("sdr_nombre")} className="flex items-center">
                SDR
                <SortIcon column="sdr_nombre" />
              </button>
            </th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50">
              <button onClick={() => toggleSort("llamadas_analizadas")} className="flex items-center justify-end w-full">
                Llamadas Analizadas
                <SortIcon column="llamadas_analizadas" />
              </button>
            </th>
            <th
              className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50"
              title="Promedio del Puntaje Total (sobre 100) de las llamadas con análisis de IA en el período."
            >
              <button onClick={() => toggleSort("puntaje_total")} className="flex items-center justify-end w-full">
                Puntaje Total
                <SortIcon column="puntaje_total" />
              </button>
            </th>
            {SCORE_CARD_CATEGORIES.map(({ label, max }) => (
              <th
                key={label}
                className="px-4 py-3 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50"
                title={`Promedio de "${label}" (sobre ${max}) — haz clic en una celda para ver las llamadas.`}
              >
                <button onClick={() => toggleSort(label)} className="flex items-center justify-end w-full">
                  {label}
                  <SortIcon column={label} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sortedData.map((row, idx) => (
            <tr key={row.sdr_id} className={idx % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"}>
              <td className="px-4 py-3 font-medium text-gray-900">{row.sdr_nombre}</td>
              <td className="px-4 py-3 text-right text-gray-700">{row.llamadas_analizadas}</td>
              <td
                className="px-4 py-3 text-right text-gray-900 font-semibold cursor-pointer hover:underline"
                onClick={() => onCellClick(row, "puntaje_total", "Puntaje Total")}
              >
                {fmt(row.puntaje_total)}/100
              </td>
              {SCORE_CARD_CATEGORIES.map(({ label, max }) => (
                <td
                  key={label}
                  className="px-4 py-3 text-right text-gray-700 cursor-pointer hover:underline"
                  onClick={() => onCellClick(row, label, label)}
                >
                  {fmt(row.desglose[label], max)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold sticky bottom-0">
            <td className="px-4 py-3 text-gray-900">Promedio</td>
            <td className="px-4 py-3 text-right text-gray-900">{promedios.llamadasAnalizadas}</td>
            <td className="px-4 py-3 text-right text-gray-900">{fmt(promedios.puntajeTotal)}/100</td>
            {SCORE_CARD_CATEGORIES.map(({ label, max }) => (
              <td key={label} className="px-4 py-3 text-right text-gray-900">
                {fmt(promedios.desglose[label], max)}
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
          <h2 className="font-semibold text-gray-900">Score de Llamadas IA</h2>
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
