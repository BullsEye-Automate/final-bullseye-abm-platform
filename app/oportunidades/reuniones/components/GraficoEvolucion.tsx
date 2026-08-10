"use client";

import { useMemo, useState } from "react";
import { Meeting } from "../page";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface ChartData {
  periodo: string;
  Si: number;
  No: number;
  Pendiente: number;
  Reagendar: number;
  total: number;
}

const STATUS_INFO = {
  Si: { color: "#22c55e", label: "Realizado" },
  No: { color: "#ef4444", label: "No Realizado" },
  Pendiente: { color: "#f59e0b", label: "Pendiente" },
  Reagendar: { color: "#8b5cf6", label: "Reagendar" },
};

export default function GraficoEvolucion({
  meetings,
  dateFrom,
  dateTo,
}: {
  meetings: Meeting[];
  dateFrom?: string;
  dateTo?: string;
}) {
  const [visibleStatus, setVisibleStatus] = useState<Set<string>>(
    new Set(["Si", "No", "Pendiente", "Reagendar"])
  );
  const [selectedBar, setSelectedBar] = useState<{ periodo: string; status: string } | null>(null);

  const chartData = useMemo(() => {
    const monthsData: Record<string, Record<string, number>> = {};

    meetings.forEach((meeting) => {
      if (!meeting.fecha_reunion) return;

      const date = new Date(meeting.fecha_reunion);
      const monthKey = date.toLocaleDateString("es-MX", { year: "numeric", month: "2-digit" });

      if (!monthsData[monthKey]) {
        monthsData[monthKey] = {
          Si: 0,
          No: 0,
          Pendiente: 0,
          Reagendar: 0,
        };
      }

      const status = meeting.realizado as "Si" | "No" | "Pendiente" | "Reagendar";
      if (status && monthsData[monthKey].hasOwnProperty(status)) {
        monthsData[monthKey][status]++;
      }
    });

    const data: ChartData[] = Object.entries(monthsData)
      .map(([periodo, counts]) => ({
        periodo,
        Si: counts.Si || 0,
        No: counts.No || 0,
        Pendiente: counts.Pendiente || 0,
        Reagendar: counts.Reagendar || 0,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => a.periodo.localeCompare(b.periodo));

    return data;
  }, [meetings]);

  const filteredMeetings = useMemo(() => {
    if (!selectedBar) return [];
    const [year, month] = selectedBar.periodo.split("/");
    return meetings.filter((m) => {
      if (!m.fecha_reunion) return false;
      const date = new Date(m.fecha_reunion);
      const dateMonth = String(date.getMonth() + 1).padStart(2, "0");
      const dateYear = String(date.getFullYear());
      return dateMonth === month && dateYear === year && m.realizado === selectedBar.status;
    });
  }, [selectedBar, meetings]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload as ChartData;
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200 text-xs">
          <p className="font-semibold text-gray-900">{data.periodo}</p>
          <p className="text-green-600">✓ Realizado: {data.Si}</p>
          <p className="text-red-600">✗ No: {data.No}</p>
          <p className="text-yellow-600">⏳ Pendiente: {data.Pendiente}</p>
          <p className="text-purple-600">🔄 Reagendar: {data.Reagendar}</p>
          <p className="font-medium text-gray-900 mt-2">Total: {data.total}</p>
        </div>
      );
    }
    return null;
  };

  const CustomLabel = ({ x, y, width, height, value }: any) => {
    if (!value) return null;
    return (
      <text
        x={x + width / 2}
        y={y - 2}
        fill="#1f2937"
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
      >
        {value}
      </text>
    );
  };

  const handleBarClick = (periodo: string, status: string) => {
    setSelectedBar({ periodo, status });
  };

  const toggleStatus = (status: string) => {
    const newVisible = new Set(visibleStatus);
    if (newVisible.has(status)) {
      newVisible.delete(status);
    } else {
      newVisible.add(status);
    }
    setVisibleStatus(newVisible);
  };

  // Calcular altura dinámica según cantidad de períodos
  const height = Math.max(300, chartData.length * 30 + 100);

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Evolución de Reuniones Agendadas</h2>
        <p className="text-xs text-gray-500">Haz clic en las etiquetas para mostrar/ocultar • Haz clic en las barras para ver detalles</p>
      </div>

      {chartData.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          No hay datos disponibles para el período seleccionado
        </div>
      ) : (
        <>
          {/* Leyenda personalizada fuera del gráfico */}
          <div className="flex flex-wrap gap-4 mb-4 p-3 bg-gray-50 rounded-lg">
            {Object.entries(STATUS_INFO).map(([key, info]) => (
              <button
                key={key}
                onClick={() => toggleStatus(key)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  visibleStatus.has(key)
                    ? "bg-white border border-gray-200"
                    : "bg-gray-200 opacity-50"
                }`}
                title={visibleStatus.has(key) ? "Click para ocultar" : "Click para mostrar"}
              >
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: info.color }}
                />
                <span className={`text-xs font-medium ${visibleStatus.has(key) ? "text-gray-900" : "text-gray-500"}`}>
                  {info.label}
                </span>
              </button>
            ))}
          </div>

          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="periodo"
                stroke="#6b7280"
                style={{ fontSize: "12px" }}
                tick={{ fill: "#6b7280" }}
              />
              <YAxis stroke="#6b7280" style={{ fontSize: "12px" }} tick={{ fill: "#6b7280" }} />
              <Tooltip content={<CustomTooltip />} />

              {visibleStatus.has("Si") && (
                <Bar
                  dataKey="Si"
                  stackId="a"
                  fill={STATUS_INFO.Si.color}
                  name="Realizado"
                  radius={[8, 8, 0, 0]}
                  label={<CustomLabel />}
                  onClick={(data: any) => handleBarClick(data.periodo, "Si")}
                />
              )}
              {visibleStatus.has("No") && (
                <Bar
                  dataKey="No"
                  stackId="a"
                  fill={STATUS_INFO.No.color}
                  name="No Realizado"
                  radius={[8, 8, 0, 0]}
                  label={<CustomLabel />}
                  onClick={(data: any) => handleBarClick(data.periodo, "No")}
                />
              )}
              {visibleStatus.has("Pendiente") && (
                <Bar
                  dataKey="Pendiente"
                  stackId="a"
                  fill={STATUS_INFO.Pendiente.color}
                  name="Pendiente"
                  radius={[8, 8, 0, 0]}
                  label={<CustomLabel />}
                  onClick={(data: any) => handleBarClick(data.periodo, "Pendiente")}
                />
              )}
              {visibleStatus.has("Reagendar") && (
                <Bar
                  dataKey="Reagendar"
                  stackId="a"
                  fill={STATUS_INFO.Reagendar.color}
                  name="Reagendar"
                  radius={[8, 8, 0, 0]}
                  label={<CustomLabel />}
                  onClick={(data: any) => handleBarClick(data.periodo, "Reagendar")}
                />
              )}
            </BarChart>
          </ResponsiveContainer>

          {/* Modal con tabla de reuniones filtradas */}
          {selectedBar && filteredMeetings.length > 0 && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-auto">
                {/* Header */}
                <div className="sticky top-0 px-6 py-4 border-b border-gray-100 bg-white flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {STATUS_INFO[selectedBar.status as keyof typeof STATUS_INFO].label} - {selectedBar.periodo}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">{filteredMeetings.length} reuniones</p>
                  </div>
                  <button
                    onClick={() => setSelectedBar(null)}
                    className="text-gray-400 hover:text-gray-600 text-xl"
                  >
                    ×
                  </button>
                </div>

                {/* Tabla */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100 sticky top-[60px]">
                      <tr>
                        <th className="px-6 py-3 text-left font-semibold text-gray-700">Empresa</th>
                        <th className="px-6 py-3 text-left font-semibold text-gray-700">Contacto</th>
                        <th className="px-6 py-3 text-left font-semibold text-gray-700">Fecha</th>
                        <th className="px-6 py-3 text-left font-semibold text-gray-700">SDR</th>
                        <th className="px-6 py-3 text-left font-semibold text-gray-700">País</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredMeetings.map((m) => (
                        <tr key={m.id} className="hover:bg-gray-50 transition">
                          <td className="px-6 py-3 text-gray-900 font-medium">{m.empresa}</td>
                          <td className="px-6 py-3 text-gray-600">
                            {m.contacto_nombre}
                            {m.contacto_cargo && <span className="text-xs text-gray-500 ml-1">({m.contacto_cargo})</span>}
                          </td>
                          <td className="px-6 py-3 text-gray-600">
                            {m.fecha_reunion ? new Date(m.fecha_reunion).toLocaleDateString("es-MX") : "—"}
                          </td>
                          <td className="px-6 py-3 text-gray-600">{m.sdr_nombre || "—"}</td>
                          <td className="px-6 py-3 text-gray-600">{m.pais || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
