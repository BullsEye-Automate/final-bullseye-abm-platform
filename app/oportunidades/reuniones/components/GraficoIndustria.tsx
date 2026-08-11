"use client";

import { useMemo, useState } from "react";
import { Meeting } from "../page";
import { IconX } from "@tabler/icons-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

interface ChartData {
  industria: string;
  Si: number;
  No: number;
  Pendiente: number;
  Reagendar: number;
  total: number;
}

interface PieData {
  name: string;
  value: number;
  original: ChartData;
}

const STATUS_INFO = {
  Si: { color: "#62E0D8", label: "Realizado" },
  No: { color: "#EF5350", label: "No Realizado" },
  Pendiente: { color: "#FFA726", label: "Pendiente" },
  Reagendar: { color: "#AB47BC", label: "Reagendar" },
};

const COLORS = [
  "#62E0D8", "#3B7FD8", "#2B5FD8", "#5B3FB8", "#8B3FA8",
  "#AB47BC", "#BB5FCC", "#CB7FDC", "#DB9FEC", "#EF5350",
  "#FF7F7F", "#FFAF7F", "#FFA726", "#FFBF5F", "#FFCF8F"
];

export default function GraficoIndustria({ meetings }: { meetings: Meeting[] }) {
  const [selectedData, setSelectedData] = useState<{ industria: string } | null>(null);

  const chartData = useMemo(() => {
    const industriaData: Record<string, Record<string, number>> = {};

    meetings.forEach((meeting) => {
      const industria = meeting.industria || "Sin industria";

      if (!industriaData[industria]) {
        industriaData[industria] = {
          Si: 0,
          No: 0,
          Pendiente: 0,
          Reagendar: 0,
        };
      }

      const status = meeting.realizado as "Si" | "No" | "Pendiente" | "Reagendar";
      if (status && industriaData[industria].hasOwnProperty(status)) {
        industriaData[industria][status]++;
      }
    });

    const data: ChartData[] = Object.entries(industriaData)
      .map(([industria, counts]) => ({
        industria,
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

  const pieData: PieData[] = useMemo(() => {
    return chartData.map((d) => ({
      name: d.industria,
      value: d.total,
      original: d,
    }));
  }, [chartData]);

  const filteredMeetings = useMemo(() => {
    if (!selectedData) return [];
    return meetings.filter((m) => m.industria === selectedData.industria);
  }, [selectedData, meetings]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload as PieData;
      return (
        <div className="bg-[#251762] border border-[#62E0D8] p-3 rounded-lg shadow-xl text-xs">
          <p className="font-semibold text-white">{data.name}</p>
          <p className="text-[#62E0D8] mt-1">✓ Realizado: {data.original.Si}</p>
          <p className="text-[#EF5350]">✗ No: {data.original.No}</p>
          <p className="text-[#FFA726]">⏳ Pendiente: {data.original.Pendiente}</p>
          <p className="text-[#AB47BC]">🔄 Reagendar: {data.original.Reagendar}</p>
          <p className="font-semibold text-[#62E0D8] mt-2">Total: {data.value}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <>
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Reuniones por Industria</h2>

        {pieData.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            No hay datos disponibles
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={400}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={120}
                  fill="#8884d8"
                  dataKey="value"
                  onClick={(data: any) => setSelectedData({ industria: data.name })}
                  style={{ cursor: "pointer" }}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "20px" }} />
              </PieChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-500 mt-4 text-center">Haz clic en cualquier segmento para ver el listado de empresas</p>
          </>
        )}
      </div>

      {selectedData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-[#251762] to-[#3a2a7d] px-8 py-6 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold text-[#62E0D8]">Reuniones</h3>
                <p className="text-[#62E0D8]/70 text-sm mt-1">Industria: {selectedData.industria}</p>
              </div>
              <div className="text-right">
                <p className="text-4xl font-bold text-[#62E0D8]">{filteredMeetings.length}</p>
                <p className="text-[#62E0D8]/70 text-xs">reuniones</p>
              </div>
              <button
                onClick={() => setSelectedData(null)}
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
                        <th className="px-6 py-4 text-left text-xs font-bold text-[#251762] uppercase tracking-wider">Estado</th>
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
                          <td className="px-6 py-4 text-sm">
                            <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                              m.realizado === "Si" ? "bg-[#62E0D8]/20 text-[#62E0D8]" :
                              m.realizado === "No" ? "bg-[#EF5350]/20 text-[#EF5350]" :
                              m.realizado === "Pendiente" ? "bg-[#FFA726]/20 text-[#FFA726]" :
                              "bg-[#AB47BC]/20 text-[#AB47BC]"
                            }`}>
                              {m.realizado}
                            </span>
                          </td>
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
