"use client";

import { useMemo, useState } from "react";
import { Meeting } from "../page";
import { IconX } from "@tabler/icons-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
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
  Si: { color: "#62E0D8", label: "Realizado", bgLight: "rgba(98,224,216,0.1)" },
  No: { color: "#EF5350", label: "No Realizado", bgLight: "rgba(239,83,80,0.1)" },
  Pendiente: { color: "#FFA726", label: "Pendiente", bgLight: "rgba(255,167,38,0.1)" },
  Reagendar: { color: "#AB47BC", label: "Reagendar", bgLight: "rgba(171,71,188,0.1)" },
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
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      const monthKey = `${month}/${year}`;

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
      .sort((a, b) => {
        const [m1, y1] = a.periodo.split("/");
        const [m2, y2] = b.periodo.split("/");
        const cmp = parseInt(y1) - parseInt(y2);
        return cmp !== 0 ? cmp : parseInt(m1) - parseInt(m2);
      });

    return data;
  }, [meetings]);

  const filteredMeetings = useMemo(() => {
    if (!selectedBar) return [];
    const [month, year] = selectedBar.periodo.split("/");
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
        <div className="bg-[#251762] border border-[#62E0D8] p-3 rounded-lg shadow-xl text-xs">
          <p className="font-semibold text-white">{data.periodo}</p>
          <p className="text-[#62E0D8] mt-1">✓ Realizado: {data.Si}</p>
          <p className="text-[#EF5350]">✗ No: {data.No}</p>
          <p className="text-[#FFA726]">⏳ Pendiente: {data.Pendiente}</p>
          <p className="text-[#AB47BC]">🔄 Reagendar: {data.Reagendar}</p>
          <p className="font-semibold text-[#62E0D8] mt-2">Total: {data.total}</p>
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
        y={y - 4}
        fill="#251762"
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fontFamily="Outfit, sans-serif"
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

  const height = Math.max(350, chartData.length * 35 + 120);

  return (
    <div className="bg-gradient-to-br from-white via-white to-[rgba(98,224,216,0.02)] rounded-2xl p-8 shadow-lg border border-[#62E0D8]/20">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-[#251762]">Evolución de Reuniones</h2>
          <p className="text-sm text-gray-500 mt-2">Desglose de reuniones agendadas por período</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-[#62E0D8]">{chartData.reduce((a, b) => a + b.total, 0)}</p>
          <p className="text-xs text-gray-500 mt-1">Total reuniones</p>
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <p>No hay datos disponibles para el período seleccionado</p>
        </div>
      ) : (
        <>
          {/* Leyenda profesional */}
          <div className="flex flex-wrap gap-3 mb-6 p-4 bg-[#251762]/5 rounded-xl border border-[#62E0D8]/10">
            {Object.entries(STATUS_INFO).map(([key, info]) => (
              <button
                key={key}
                onClick={() => toggleStatus(key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                  visibleStatus.has(key)
                    ? "bg-white border-2 border-[#62E0D8]"
                    : "bg-gray-100 opacity-40 border-2 border-transparent"
                }`}
              >
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: info.color }} />
                <span className={`text-sm ${visibleStatus.has(key) ? "text-[#251762]" : "text-gray-500"}`}>
                  {info.label}
                </span>
              </button>
            ))}
          </div>

          {/* Gráfico */}
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <ResponsiveContainer width="100%" height={height}>
              <BarChart data={chartData} margin={{ top: 30, right: 30, left: 0, bottom: 20 }}>
                <defs>
                  <linearGradient id="siGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#62E0D8" stopOpacity={1} />
                    <stop offset="100%" stopColor="#62E0D8" stopOpacity={0.7} />
                  </linearGradient>
                  <linearGradient id="noGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#EF5350" stopOpacity={1} />
                    <stop offset="100%" stopColor="#EF5350" stopOpacity={0.7} />
                  </linearGradient>
                  <linearGradient id="pendienteGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFA726" stopOpacity={1} />
                    <stop offset="100%" stopColor="#FFA726" stopOpacity={0.7} />
                  </linearGradient>
                  <linearGradient id="reagendarGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#AB47BC" stopOpacity={1} />
                    <stop offset="100%" stopColor="#AB47BC" stopOpacity={0.7} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#E5E7EB" vertical={false} />
                <XAxis
                  dataKey="periodo"
                  stroke="#9CA3AF"
                  style={{ fontSize: "12px", fontWeight: 600 }}
                  tick={{ fill: "#6B7280" }}
                  axisLine={{ stroke: "#D1D5DB" }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  style={{ fontSize: "12px", fontWeight: 600 }}
                  tick={{ fill: "#6B7280" }}
                  axisLine={{ stroke: "#D1D5DB" }}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(98,224,216,0.1)" }} />

                {visibleStatus.has("Si") && (
                  <Bar
                    dataKey="Si"
                    stackId="a"
                    fill="url(#siGradient)"
                    radius={[8, 8, 0, 0]}
                    label={<CustomLabel />}
                    onClick={(data: any) => handleBarClick(data.periodo, "Si")}
                    style={{ cursor: "pointer" }}
                  />
                )}
                {visibleStatus.has("No") && (
                  <Bar
                    dataKey="No"
                    stackId="a"
                    fill="url(#noGradient)"
                    radius={[8, 8, 0, 0]}
                    label={<CustomLabel />}
                    onClick={(data: any) => handleBarClick(data.periodo, "No")}
                    style={{ cursor: "pointer" }}
                  />
                )}
                {visibleStatus.has("Pendiente") && (
                  <Bar
                    dataKey="Pendiente"
                    stackId="a"
                    fill="url(#pendienteGradient)"
                    radius={[8, 8, 0, 0]}
                    label={<CustomLabel />}
                    onClick={(data: any) => handleBarClick(data.periodo, "Pendiente")}
                    style={{ cursor: "pointer" }}
                  />
                )}
                {visibleStatus.has("Reagendar") && (
                  <Bar
                    dataKey="Reagendar"
                    stackId="a"
                    fill="url(#reagendarGradient)"
                    radius={[8, 8, 0, 0]}
                    label={<CustomLabel />}
                    onClick={(data: any) => handleBarClick(data.periodo, "Reagendar")}
                    style={{ cursor: "pointer" }}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="text-xs text-gray-500 mt-4 text-center">Haz clic en cualquier barra para ver el listado de empresas</p>

          {/* Modal */}
          {selectedBar && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#251762] to-[#3a2a7d] px-8 py-6 flex items-center justify-between">
                  <div>
                    <h3 className="text-2xl font-bold text-[#62E0D8]">
                      {STATUS_INFO[selectedBar.status as keyof typeof STATUS_INFO].label}
                    </h3>
                    <p className="text-[#62E0D8]/70 text-sm mt-1">Período: {selectedBar.periodo}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-4xl font-bold text-[#62E0D8]">{filteredMeetings.length}</p>
                    <p className="text-[#62E0D8]/70 text-xs">reuniones</p>
                  </div>
                  <button
                    onClick={() => setSelectedBar(null)}
                    className="ml-4 p-2 hover:bg-[#62E0D8]/20 rounded-lg transition-colors"
                  >
                    <IconX size={24} className="text-[#62E0D8]" />
                  </button>
                </div>

                {/* Contenido */}
                <div className="flex-1 overflow-y-auto">
                  {filteredMeetings.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-gray-400">
                      <p>No hay reuniones registradas en este período</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-[#F3F4F6] border-b-2 border-[#62E0D8]/20 sticky top-0">
                          <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-[#251762] uppercase tracking-wider">Empresa</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-[#251762] uppercase tracking-wider">Contacto</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-[#251762] uppercase tracking-wider">Cargo</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-[#251762] uppercase tracking-wider">Fecha</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-[#251762] uppercase tracking-wider">SDR</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-[#251762] uppercase tracking-wider">País</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredMeetings.map((m, idx) => (
                            <tr
                              key={m.id}
                              className={`border-b border-gray-100 transition-colors ${
                                idx % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]"
                              } hover:bg-[#62E0D8]/5`}
                            >
                              <td className="px-6 py-4 text-sm font-semibold text-[#251762]">{m.empresa}</td>
                              <td className="px-6 py-4 text-sm text-gray-700">{m.contacto_nombre || "—"}</td>
                              <td className="px-6 py-4 text-sm text-gray-600">{m.contacto_cargo || "—"}</td>
                              <td className="px-6 py-4 text-sm text-gray-700">
                                {m.fecha_reunion ? new Date(m.fecha_reunion).toLocaleDateString("es-MX") : "—"}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-600">{m.sdr_nombre || "—"}</td>
                              <td className="px-6 py-4 text-sm text-gray-600">{m.pais || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
