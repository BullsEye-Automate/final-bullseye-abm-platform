"use client";

import { useMemo } from "react";
import { Meeting } from "../page";
import {
  LineChart,
  Line,
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
  periodo: string;
  Si: number;
  No: number;
  Pendiente: number;
  Reagendar: number;
  total: number;
}

const COLORS = {
  Si: "#22c55e",
  No: "#ef4444",
  Pendiente: "#f59e0b",
  Reagendar: "#8b5cf6",
};

const COLORS_HEX = {
  Si: "#22c55e",
  No: "#ef4444",
  Pendiente: "#f59e0b",
  Reagendar: "#8b5cf6",
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
  const chartData = useMemo(() => {
    const monthsData: Record<string, Record<string, number>> = {};

    // Agrupar reuniones por mes
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

    // Convertir a array y ordenar
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

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">Evolución de Reuniones Agendadas</h2>

      {chartData.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          No hay datos disponibles para el período seleccionado
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={400}>
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
            <Legend
              wrapperStyle={{ fontSize: "12px", paddingTop: "20px" }}
              iconType="square"
            />
            <Bar dataKey="Si" stackId="a" fill={COLORS_HEX.Si} name="Realizado" radius={[8, 8, 0, 0]} />
            <Bar dataKey="No" stackId="a" fill={COLORS_HEX.No} name="No Realizado" radius={[8, 8, 0, 0]} />
            <Bar
              dataKey="Pendiente"
              stackId="a"
              fill={COLORS_HEX.Pendiente}
              name="Pendiente"
              radius={[8, 8, 0, 0]}
            />
            <Bar
              dataKey="Reagendar"
              stackId="a"
              fill={COLORS_HEX.Reagendar}
              name="Reagendar"
              radius={[8, 8, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
