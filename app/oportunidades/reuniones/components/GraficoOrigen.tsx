"use client";

import { useMemo } from "react";
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
} from "recharts";

interface ChartData {
  origen: string;
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

export default function GraficoOrigen({ meetings }: { meetings: Meeting[] }) {
  const chartData = useMemo(() => {
    const origenData: Record<string, Record<string, number>> = {};

    meetings.forEach((meeting) => {
      const origen = meeting.origen || "Sin origen";

      if (!origenData[origen]) {
        origenData[origen] = {
          Si: 0,
          No: 0,
          Pendiente: 0,
          Reagendar: 0,
        };
      }

      const status = meeting.realizado as "Si" | "No" | "Pendiente" | "Reagendar";
      if (status && origenData[origen].hasOwnProperty(status)) {
        origenData[origen][status]++;
      }
    });

    const data: ChartData[] = Object.entries(origenData)
      .map(([origen, counts]) => ({
        origen,
        Si: counts.Si || 0,
        No: counts.No || 0,
        Pendiente: counts.Pendiente || 0,
        Reagendar: counts.Reagendar || 0,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total);

    return data;
  }, [meetings]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload as ChartData;
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200 text-xs">
          <p className="font-semibold text-gray-900">{data.origen}</p>
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
      <h2 className="text-lg font-semibold text-gray-900 mb-6">Reuniones por Origen</h2>

      {chartData.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          No hay datos disponibles
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 180, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis type="number" stroke="#6b7280" style={{ fontSize: "12px" }} />
            <YAxis
              dataKey="origen"
              type="category"
              stroke="#6b7280"
              style={{ fontSize: "12px" }}
              width={170}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "20px" }} iconType="square" />
            <Bar dataKey="Si" stackId="a" fill={COLORS.Si} name="Realizado" />
            <Bar dataKey="No" stackId="a" fill={COLORS.No} name="No Realizado" />
            <Bar dataKey="Pendiente" stackId="a" fill={COLORS.Pendiente} name="Pendiente" />
            <Bar dataKey="Reagendar" stackId="a" fill={COLORS.Reagendar} name="Reagendar" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
