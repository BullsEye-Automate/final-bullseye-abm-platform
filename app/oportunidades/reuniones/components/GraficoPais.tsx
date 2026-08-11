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
  Legend,
  ResponsiveContainer,
} from "recharts";

interface ChartData {
  pais: string;
  Si: number;
  No: number;
  Pendiente: number;
  Reagendar: number;
  total: number;
}

const STATUS_INFO = {
  Si: { color: "#62E0D8", label: "Realizado" },
  No: { color: "#EF5350", label: "No Realizado" },
  Pendiente: { color: "#FFA726", label: "Pendiente" },
  Reagendar: { color: "#AB47BC", label: "Reagendar" },
};

const COLORS = {
  Si: "#62E0D8",
  No: "#EF5350",
  Pendiente: "#FFA726",
  Reagendar: "#AB47BC",
};

export default function GraficoPais({ meetings }: { meetings: Meeting[] }) {
  const [selectedBar, setSelectedBar] = useState<{ pais: string; status: string } | null>(null);

  const chartData = useMemo(() => {
    const paisData: Record<string, Record<string, number>> = {};

    meetings.forEach((meeting) => {
      const pais = meeting.pais || "Sin país";

      if (!paisData[pais]) {
        paisData[pais] = {
          Si: 0,
          No: 0,
          Pendiente: 0,
          Reagendar: 0,
        };
      }

      const status = meeting.realizado as "Si" | "No" | "Pendiente" | "Reagendar";
      if (status && paisData[pais].hasOwnProperty(status)) {
        paisData[pais][status]++;
      }
    });

    const data: ChartData[] = Object.entries(paisData)
      .map(([pais, counts]) => ({
        pais,
        Si: counts.Si || 0,
        No: counts.No || 0,
        Pendiente: counts.Pendiente || 0,
        Reagendar: counts.Reagendar || 0,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    return data;
  }, [meetings]);

  const filteredMeetings = useMemo(() => {
    if (!selectedBar) return [];
    return meetings.filter(
      (m) => m.pais === selectedBar.pais && m.realizado === selectedBar.status
    );
  }, [selectedBar, meetings]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload as ChartData;
      return (
        <div className="bg-[#251762] border border-[#62E0D8] p-3 rounded-lg shadow-xl text-xs">
          <p className="font-semibold text-white">{data.pais}</p>
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

  const handleBarClick = (pais: string, status: string) => {
    setSelectedBar({ pais, status });
  };

  return (
    <>
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Reuniones por País</h2>

        {chartData.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            No hay datos disponibles
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 150, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" stroke="#6b7280" style={{ fontSize: "12px" }} />
                <YAxis
                  dataKey="pais"
                  type="category"
                  stroke="#6b7280"
                  style={{ fontSize: "12px" }}
                  width={140}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(98,224,216,0.1)" }} />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "20px" }} iconType="square" />
                <Bar
                  dataKey="Si"
                  stackId="a"
                  fill={COLORS.Si}
                  name="Realizado"
                  onClick={(data: any) => handleBarClick(data.pais, "Si")}
                  style={{ cursor: "pointer" }}
                />
                <Bar
                  dataKey="No"
                  stackId="a"
                  fill={COLORS.No}
                  name="No Realizado"
                  onClick={(data: any) => handleBarClick(data.pais, "No")}
                  style={{ cursor: "pointer" }}
                />
                <Bar
                  dataKey="Pendiente"
                  stackId="a"
                  fill={COLORS.Pendiente}
                  name="Pendiente"
                  onClick={(data: any) => handleBarClick(data.pais, "Pendiente")}
                  style={{ cursor: "pointer" }}
                />
                <Bar
                  dataKey="Reagendar"
                  stackId="a"
                  fill={COLORS.Reagendar}
                  name="Reagendar"
                  onClick={(data: any) => handleBarClick(data.pais, "Reagendar")}
                  style={{ cursor: "pointer" }}
                />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-500 mt-4 text-center">Haz clic en cualquier barra para ver el listado de empresas</p>
          </>
        )}
      </div>

      {selectedBar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-[#251762] to-[#3a2a7d] px-8 py-6 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold text-[#62E0D8]">
                  {STATUS_INFO[selectedBar.status as keyof typeof STATUS_INFO].label}
                </h3>
                <p className="text-[#62E0D8]/70 text-sm mt-1">País: {selectedBar.pais}</p>
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

            <div className="flex-1 overflow-y-auto">
              {filteredMeetings.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-gray-400">
                  <p>No hay reuniones registradas en esta categoría</p>
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
  );
}
