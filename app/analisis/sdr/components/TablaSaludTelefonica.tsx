"use client";

import { useMemo, useState } from "react";
import { IconArrowUp, IconArrowDown, IconMaximize, IconX, IconAlertTriangle } from "@tabler/icons-react";

export interface NumeroSalud {
  numero: string;
  numero_nombre: string;
  cliente_id: string | null;
  cliente_nombre: string;
  pais: string;
  llamadas: number;
  llamadas_conectadas: number;
  tasa_conexion: number;
  llamadas_periodo_anterior: number;
  llamadas_conectadas_periodo_anterior: number;
  tasa_conexion_anterior: number | null;
  delta_puntos: number | null;
}

type SortKey = keyof NumeroSalud;
type SortDir = "asc" | "desc";

// Umbral de caída (en puntos porcentuales de tasa de conexión vs. el período
// anterior) a partir del cual se destaca la fila — señal indirecta de que el
// número podría estar marcado como spam por las operadoras. Solo se aplica
// con volumen mínimo de llamadas para no marcar ruido de muestras chicas.
const MIN_LLAMADAS_PARA_ALERTA = 5;
const CAIDA_ALERTA = -15;
const CAIDA_ADVERTENCIA = -8;

function rowHighlight(row: NumeroSalud): "alerta" | "advertencia" | null {
  if (row.llamadas < MIN_LLAMADAS_PARA_ALERTA || row.delta_puntos === null) return null;
  if (row.delta_puntos <= CAIDA_ALERTA) return "alerta";
  if (row.delta_puntos <= CAIDA_ADVERTENCIA) return "advertencia";
  return null;
}

function formatPct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

function formatDelta(v: number | null): string {
  if (v === null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)} pts`;
}

const COLUMNS: { key: SortKey; label: string; description: string }[] = [
  { key: "cliente_nombre", label: "Cliente", description: "Cliente al que está asignado el número." },
  { key: "pais", label: "País", description: "País del número, según Allo." },
  { key: "llamadas", label: "Llamadas", description: "Llamadas salientes en el período." },
  {
    key: "llamadas_conectadas",
    label: "Conectadas",
    description: "Llamadas contestadas o transferidas que duraron 60 segundos o más (excluye buzón de voz y cortes).",
  },
  {
    key: "tasa_conexion",
    label: "Tasa de Conexión",
    description: "Conectadas ÷ Llamadas del período.",
  },
  {
    key: "tasa_conexion_anterior",
    label: "Tasa Anterior",
    description: "Misma tasa, pero del período anterior de igual duración — sin datos si no hubo llamadas.",
  },
  {
    key: "delta_puntos",
    label: "Δ vs. Anterior",
    description:
      "Tasa de Conexión − Tasa Anterior, en puntos porcentuales. Una caída sostenida suele ser la señal más clara (indirecta) de que el número quedó marcado como spam.",
  },
];

export default function TablaSaludTelefonica({ data }: { data: NumeroSalud[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("delta_puntos");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      // null (sin período anterior) siempre al final, sin importar la dirección
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      if (typeof aVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal);
      }
      const numA = aVal as number;
      const numB = bVal as number;
      return sortDir === "asc" ? numA - numB : numB - numA;
    });
  }, [data, sortKey, sortDir]);

  const totals = useMemo(() => {
    const llamadas = data.reduce((acc, d) => acc + d.llamadas, 0);
    const conectadas = data.reduce((acc, d) => acc + d.llamadas_conectadas, 0);
    const llamadasPrev = data.reduce((acc, d) => acc + d.llamadas_periodo_anterior, 0);
    const conectadasPrev = data.reduce((acc, d) => acc + d.llamadas_conectadas_periodo_anterior, 0);
    const tasa = llamadas > 0 ? (conectadas / llamadas) * 100 : 0;
    const tasaPrev = llamadasPrev > 0 ? (conectadasPrev / llamadasPrev) * 100 : null;
    return {
      llamadas,
      llamadas_conectadas: conectadas,
      tasa_conexion: tasa,
      llamadas_periodo_anterior: llamadasPrev,
      tasa_conexion_anterior: tasaPrev,
      delta_puntos: tasaPrev === null ? null : tasa - tasaPrev,
    };
  }, [data]);

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
      <IconArrowUp size={14} className="inline ml-1" />
    ) : (
      <IconArrowDown size={14} className="inline ml-1" />
    );
  };

  if (data.length === 0) {
    return <div className="flex items-center justify-center py-8 text-ink-muted">No hay datos disponibles</div>;
  }

  const rowClass = (row: NumeroSalud, idx: number) => {
    const highlight = rowHighlight(row);
    if (highlight === "alerta") return "bg-red-50 hover:bg-red-100";
    if (highlight === "advertencia") return "bg-amber-50 hover:bg-amber-100";
    return idx % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100";
  };

  const table = (
    <div className={isFullscreen ? "overflow-auto h-full" : "overflow-auto max-h-[600px]"}>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
          <tr>
            <th
              className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 bg-gray-50"
              title="Número de Allo y su nombre asignado."
            >
              <button onClick={() => toggleSort("numero_nombre")} className="flex items-center">
                Número
                <SortIcon column="numero_nombre" />
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
          {sortedData.map((row, idx) => {
            const highlight = rowHighlight(row);
            return (
              <tr key={row.numero} className={rowClass(row, idx)}>
                <td className="px-4 py-3 font-medium text-gray-900">
                  <div className="flex items-center gap-1.5">
                    {highlight === "alerta" && (
                      <IconAlertTriangle size={14} className="text-red-500 shrink-0" />
                    )}
                    <div>
                      <div>{row.numero_nombre}</div>
                      <div className="text-xs text-gray-400 font-normal">{row.numero}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-gray-700">{row.cliente_nombre}</td>
                <td className="px-4 py-3 text-right text-gray-700">{row.pais}</td>
                <td className="px-4 py-3 text-right text-gray-700">{row.llamadas}</td>
                <td className="px-4 py-3 text-right text-gray-700">{row.llamadas_conectadas}</td>
                <td className="px-4 py-3 text-right text-gray-700">{formatPct(row.tasa_conexion)}</td>
                <td className="px-4 py-3 text-right text-gray-700">{formatPct(row.tasa_conexion_anterior)}</td>
                <td
                  className={`px-4 py-3 text-right font-medium ${
                    row.delta_puntos === null
                      ? "text-gray-400"
                      : row.delta_puntos <= CAIDA_ALERTA
                      ? "text-red-600"
                      : row.delta_puntos <= CAIDA_ADVERTENCIA
                      ? "text-amber-600"
                      : row.delta_puntos < 0
                      ? "text-gray-700"
                      : "text-green-600"
                  }`}
                >
                  {formatDelta(row.delta_puntos)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold sticky bottom-0">
            <td className="px-4 py-3 text-gray-900">Total</td>
            <td className="px-4 py-3 text-right text-gray-900">—</td>
            <td className="px-4 py-3 text-right text-gray-900">—</td>
            <td className="px-4 py-3 text-right text-gray-900">{totals.llamadas}</td>
            <td className="px-4 py-3 text-right text-gray-900">{totals.llamadas_conectadas}</td>
            <td className="px-4 py-3 text-right text-gray-900">{formatPct(totals.tasa_conexion)}</td>
            <td className="px-4 py-3 text-right text-gray-900">{formatPct(totals.tasa_conexion_anterior)}</td>
            <td className="px-4 py-3 text-right text-gray-900">{formatDelta(totals.delta_puntos)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
          <h2 className="font-semibold text-gray-900">Salud Telefónica</h2>
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
