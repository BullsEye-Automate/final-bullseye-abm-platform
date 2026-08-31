"use client";

import { useMemo, useState } from "react";
import { IconArrowUp, IconArrowDown } from "@tabler/icons-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

export interface MeetingDetail {
  id: string;
  sdr_nombre: string;
  client_name?: string;
  prospecto_nombre?: string;
  empresa?: string;
  fecha_agendamiento?: string;
  fecha_reunion: string;
  origen: string;
}

type SortKey = "sdr_nombre" | "client_name" | "prospecto_nombre" | "empresa" | "origen" | "fecha_agendamiento" | "fecha_reunion";
type SortDir = "asc" | "desc";

const COLORS = [
  "#62E0D8", "#3B7FD8", "#2B5FD8", "#5B3FB8", "#8B3FA8",
  "#AB47BC", "#BB5FCC", "#CB7FDC", "#DB9FEC", "#EF5350",
  "#FF7F7F", "#FFAF7F", "#FFA726", "#FFBF5F", "#FFCF8F",
];

// fecha_reunion / fecha_agendamiento son columnas DATE (sin hora) — se
// formatean anclando a UTC explícitamente para no correr el día al
// formatear en el navegador (mismo criterio que ModalReuniones.tsx).
function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "N/A";
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "sdr_nombre", label: "SDR" },
  { key: "client_name", label: "Cliente" },
  { key: "prospecto_nombre", label: "Prospecto" },
  { key: "empresa", label: "Empresa" },
  { key: "origen", label: "Origen" },
  { key: "fecha_agendamiento", label: "Fecha de agendamiento" },
  { key: "fecha_reunion", label: "Fecha de reunión" },
];

export default function OrigenPieYDetalle({ reuniones }: { reuniones: MeetingDetail[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("sdr_nombre");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Orígenes ocultos del gráfico de torta (clic en la leyenda o en la
  // tabla de resumen para ocultar/mostrar). No afecta la tabla de detalle
  // de abajo, que siempre lista todas las reuniones.
  const [hiddenOrigenes, setHiddenOrigenes] = useState<Set<string>>(new Set());

  const pieData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of reuniones) {
      counts[r.origen] = (counts[r.origen] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [reuniones]);

  // Color estable por origen (no por índice dentro del array filtrado) para
  // que el color de cada uno no cambie al ocultar/mostrar otros.
  const colorByName = useMemo(() => {
    const map = new Map<string, string>();
    pieData.forEach((d, index) => map.set(d.name, COLORS[index % COLORS.length]));
    return map;
  }, [pieData]);

  const visiblePieData = useMemo(
    () => pieData.filter((d) => !hiddenOrigenes.has(d.name)),
    [pieData, hiddenOrigenes]
  );
  const visibleTotal = visiblePieData.reduce((sum, d) => sum + d.value, 0);

  const toggleOrigen = (name: string) => {
    setHiddenOrigenes((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const total = reuniones.length;

  const sortedReuniones = useMemo(() => {
    return [...reuniones].sort((a, b) => {
      const aVal = a[sortKey] || "";
      const bVal = b[sortKey] || "";
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }, [reuniones, sortKey, sortDir]);

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

  // Etiqueta (nombre + %) dibujada dentro de la porción, en vez de afuera
  // con línea guía — así no se pisan entre sí cuando hay una porción
  // grande y varias chicas apretadas en un arco corto. Las porciones muy
  // chicas (< MIN_LABEL_PERCENT) se quedan sin texto encima para que no
  // se amontone; igual quedan coloreadas y se leen exactas en la tabla.
  const MIN_LABEL_PERCENT = 0.04;
  const RADIAN = Math.PI / 180;
  const renderPieLabel = (props: any) => {
    const { cx, cy, midAngle, innerRadius, outerRadius, percent, name } = props;
    if (percent < MIN_LABEL_PERCENT) return null;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.62;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={12}
        fontWeight={700}
        fill="#fff"
        stroke="#251762"
        strokeWidth={3}
        paintOrder="stroke"
        style={{ pointerEvents: "none" }}
      >
        {`${name} ${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload as { name: string; value: number };
      // % relativo a lo que se está mostrando en la torta (orígenes
      // ocultos no cuentan) — la tabla de al lado sí muestra siempre el %
      // sobre el total general.
      const percentage = visibleTotal > 0 ? ((data.value / visibleTotal) * 100).toFixed(1) : "0";
      return (
        <div className="bg-[#251762] border border-[#62E0D8] p-3 rounded-lg shadow-xl text-xs">
          <p className="font-semibold text-white">{data.name}</p>
          <p className="text-[#62E0D8] mt-1">
            {data.value} reuniones ({percentage}%)
          </p>
        </div>
      );
    }
    return null;
  };

  if (reuniones.length === 0) {
    return <div className="flex items-center justify-center py-12 text-ink-muted">No hay reuniones en este período</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row gap-6 items-stretch">
        <div className="flex-1 min-w-0">
          {visiblePieData.length === 0 ? (
            <div className="flex items-center justify-center h-[360px] text-ink-muted text-sm">
              Todos los orígenes están ocultos — haz clic en la leyenda o en la tabla para mostrarlos.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <PieChart>
                <Pie
                  data={visiblePieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={130}
                  dataKey="value"
                  label={renderPieLabel}
                  labelLine={false}
                >
                  {visiblePieData.map((entry) => (
                    <Cell key={entry.name} fill={colorByName.get(entry.name)} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}

          {/* Leyenda propia (en vez de la de recharts) para que un origen
              oculto siga apareciendo acá y se pueda volver a mostrar. */}
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
            {pieData.map((d) => {
              const hidden = hiddenOrigenes.has(d.name);
              return (
                <button
                  key={d.name}
                  onClick={() => toggleOrigen(d.name)}
                  className={`flex items-center gap-1.5 text-xs transition ${
                    hidden ? "text-gray-400 line-through" : "text-gray-700 hover:text-gray-900"
                  }`}
                  title={hidden ? "Mostrar en el gráfico" : "Ocultar del gráfico"}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: hidden ? "#D1D5DB" : colorByName.get(d.name) }}
                  />
                  {d.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:w-[380px] shrink-0 overflow-auto max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Origen</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">Reuniones</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">% del total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pieData.map((d, idx) => {
                const hidden = hiddenOrigenes.has(d.name);
                return (
                  <tr
                    key={d.name}
                    onClick={() => toggleOrigen(d.name)}
                    className={`cursor-pointer transition ${hidden ? "opacity-40" : ""} ${
                      idx % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"
                    }`}
                    title={hidden ? "Mostrar en el gráfico" : "Ocultar del gráfico"}
                  >
                    <td className="px-3 py-2 font-medium text-gray-900">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: colorByName.get(d.name) }}
                        />
                        <span className={hidden ? "line-through" : ""}>{d.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">{d.value}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-700">
                      {total > 0 ? ((d.value / total) * 100).toFixed(1) : "0"}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                <td className="px-3 py-2 text-gray-900">Total</td>
                <td className="px-3 py-2 text-right text-gray-900">{total}</td>
                <td className="px-3 py-2 text-right text-gray-900">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="overflow-auto max-h-[420px]">
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
            {sortedReuniones.map((r, idx) => (
              <tr key={r.id} className={idx % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"}>
                <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{r.sdr_nombre}</td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{r.client_name || "N/A"}</td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{r.prospecto_nombre || "N/A"}</td>
                <td className="px-4 py-3 text-gray-700">{r.empresa || "N/A"}</td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{r.origen}</td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(r.fecha_agendamiento)}</td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(r.fecha_reunion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
