"use client";

import { useMemo } from "react";
import { IconInfoCircle } from "@tabler/icons-react";

export interface CeldaHeatmap {
  dia: number; // 0=Lunes ... 6=Domingo
  hora: number; // 0-23, hora de Chile
  llamadas: number;
  conectadas: number;
  tasa: number; // %, 0 si no hubo llamadas
}

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

// Con menos llamadas que esto en la celda, la tasa es ruido de muestra chica
// (ej. 1 de 1 = 100%) — se pinta en gris en vez de aportar al color.
const MIN_LLAMADAS_PARA_COLOR = 3;

function colorForTasa(tasa: number, llamadas: number): string {
  if (llamadas < MIN_LLAMADAS_PARA_COLOR) return "#f3f4f6";
  const clamped = Math.max(0, Math.min(100, tasa));
  const alpha = 0.12 + (clamped / 100) * 0.78;
  return `rgba(16, 163, 127, ${alpha.toFixed(2)})`;
}

function textColorFor(tasa: number, llamadas: number): string {
  if (llamadas < MIN_LLAMADAS_PARA_COLOR) return "#9ca3af";
  return tasa >= 55 ? "#ffffff" : "#111827";
}

export default function MapaCalorHorarios({
  heatmap,
  totalLlamadas,
}: {
  heatmap: CeldaHeatmap[];
  totalLlamadas: number;
}) {
  const grid = useMemo(() => {
    const g: CeldaHeatmap[][] = Array.from({ length: 7 }, (_, dia) =>
      Array.from({ length: 24 }, (_, hora) => ({ dia, hora, llamadas: 0, conectadas: 0, tasa: 0 }))
    );
    for (const c of heatmap) {
      g[c.dia][c.hora] = c;
    }
    return g;
  }, [heatmap]);

  // Oculta horas sin ninguna llamada en toda la semana (ej. madrugada) para
  // no mostrar un grid lleno de columnas vacías.
  const horasConDatos = useMemo(() => {
    const horas: number[] = [];
    for (let h = 0; h < 24; h++) {
      const total = grid.reduce((acc, dia) => acc + dia[h].llamadas, 0);
      if (total > 0) horas.push(h);
    }
    return horas;
  }, [grid]);

  const mejores = useMemo(() => {
    return [...heatmap]
      .filter((c) => c.llamadas >= MIN_LLAMADAS_PARA_COLOR)
      .sort((a, b) => b.tasa - a.tasa || b.llamadas - a.llamadas)
      .slice(0, 5);
  }, [heatmap]);

  if (totalLlamadas === 0 || horasConDatos.length === 0) {
    return <div className="flex items-center justify-center py-8 text-ink-muted">No hay datos disponibles</div>;
  }

  return (
    <div className="space-y-4">
      {mejores.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {mejores.map((c, i) => (
            <div
              key={`${c.dia}-${c.hora}`}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs"
            >
              <span className="font-semibold text-emerald-700">#{i + 1}</span>
              <span className="text-gray-700">
                {DIAS[c.dia]} {String(c.hora).padStart(2, "0")}:00
              </span>
              <span className="text-emerald-700 font-medium">{c.tasa.toFixed(0)}%</span>
              <span className="text-gray-400">({c.llamadas} llamadas)</span>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th className="text-xs text-ink-muted font-medium text-left pr-2 sticky left-0 bg-white" />
              {horasConDatos.map((h) => (
                <th
                  key={h}
                  className="text-[10px] text-ink-muted font-medium text-center px-1"
                  style={{ minWidth: 34 }}
                >
                  {String(h).padStart(2, "0")}h
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DIAS.map((diaLabel, dia) => (
              <tr key={dia}>
                <td className="text-xs text-gray-700 font-medium pr-2 whitespace-nowrap sticky left-0 bg-white">
                  {diaLabel}
                </td>
                {horasConDatos.map((hora) => {
                  const celda = grid[dia][hora];
                  return (
                    <td
                      key={hora}
                      className="text-center align-middle rounded"
                      style={{ width: 34, height: 30, backgroundColor: colorForTasa(celda.tasa, celda.llamadas) }}
                      title={`${diaLabel} ${String(hora).padStart(2, "0")}:00 — ${celda.llamadas} llamadas, ${celda.conectadas} conectadas (${celda.llamadas > 0 ? celda.tasa.toFixed(0) : 0}%)`}
                    >
                      <span className="text-[10px] font-medium" style={{ color: textColorFor(celda.tasa, celda.llamadas) }}>
                        {celda.llamadas > 0 ? `${celda.tasa.toFixed(0)}%` : ""}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <IconInfoCircle size={14} className="shrink-0" />
        Celdas en gris: menos de {MIN_LLAMADAS_PARA_COLOR} llamadas en ese horario (muestra insuficiente para
        confiar en la tasa). El color va de más pálido (tasa baja) a verde intenso (tasa alta) — pasa el mouse
        sobre una celda para ver el detalle.
      </div>
    </div>
  );
}
