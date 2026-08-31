"use client";

import { useMemo, useState } from "react";
import { IconArrowUp, IconArrowDown } from "@tabler/icons-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

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

  const pieData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of reuniones) {
      counts[r.origen] = (counts[r.origen] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [reuniones]);

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

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload as { name: string; value: number };
      const percentage = total > 0 ? ((data.value / total) * 100).toFixed(1) : "0";
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
      <ResponsiveContainer width="100%" height={360}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={({ name }) => name}
            outerRadius={110}
            dataKey="value"
          >
            {pieData.map((entry, index) => (
              <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "16px" }} />
        </PieChart>
      </ResponsiveContainer>

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
