"use client";

import { useMemo } from "react";
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

interface ResultadosDia {
  fecha: string;
  llamadas_realizadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
}

interface GraficoResultadosSdrProps {
  data: ResultadosDia[];
  granularidad?: "dia" | "semana" | "mes";
}

export default function GraficoResultadosSdr({
  data,
  granularidad = "dia",
}: GraficoResultadosSdrProps) {
  const chartData = useMemo(() => {
    if (granularidad === "dia") {
      return data.map((d) => ({
        fecha: new Date(d.fecha).toLocaleDateString("es-MX", {
          month: "short",
          day: "numeric",
        }),
        Llamadas: d.llamadas_realizadas,
        "Reuniones Agendadas": d.reuniones_agendadas,
        "Reuniones Realizadas": d.reuniones_realizadas,
      }));
    }

    // Agrupar por semana
    if (granularidad === "semana") {
      const byWeek: Record<string, ResultadosDia[]> = {};
      for (const item of data) {
        const date = new Date(item.fecha);
        const weekStart = new Date(date);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekKey = weekStart.toISOString().split("T")[0];

        if (!byWeek[weekKey]) byWeek[weekKey] = [];
        byWeek[weekKey].push(item);
      }

      return Object.entries(byWeek).map(([week, items]) => ({
        fecha: `Sem ${new Date(week).toLocaleDateString("es-MX", { month: "short", day: "numeric" })}`,
        Llamadas: items.reduce((sum, i) => sum + i.llamadas_realizadas, 0),
        "Reuniones Agendadas": items.reduce((sum, i) => sum + i.reuniones_agendadas, 0),
        "Reuniones Realizadas": items.reduce((sum, i) => sum + i.reuniones_realizadas, 0),
      }));
    }

    // Agrupar por mes
    const byMonth: Record<string, ResultadosDia[]> = {};
    for (const item of data) {
      const date = new Date(item.fecha);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

      if (!byMonth[monthKey]) byMonth[monthKey] = [];
      byMonth[monthKey].push(item);
    }

    return Object.entries(byMonth).map(([month, items]) => ({
      fecha: new Date(`${month}-01`).toLocaleDateString("es-MX", {
        month: "long",
        year: "numeric",
      }),
      Llamadas: items.reduce((sum, i) => sum + i.llamadas_realizadas, 0),
      "Reuniones Agendadas": items.reduce((sum, i) => sum + i.reuniones_agendadas, 0),
      "Reuniones Realizadas": items.reduce((sum, i) => sum + i.reuniones_realizadas, 0),
    }));
  }, [data, granularidad]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200 text-xs">
          <p className="font-semibold text-gray-900">{payload[0].payload.fecha}</p>
          <p className="text-brand">📞 Llamadas: {payload[0].payload.Llamadas}</p>
          <p className="text-blue-600">📅 Agendadas: {payload[0].payload["Reuniones Agendadas"]}</p>
          <p className="text-green-600">✓ Realizadas: {payload[0].payload["Reuniones Realizadas"]}</p>
        </div>
      );
    }
    return null;
  };

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        No hay datos disponibles
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="fecha" stroke="#6b7280" style={{ fontSize: "12px" }} />
        <YAxis stroke="#6b7280" style={{ fontSize: "12px" }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "20px" }} />
        <Bar dataKey="Llamadas" fill="#62E0D8" radius={[8, 8, 0, 0]} />
        <Bar dataKey="Reuniones Agendadas" fill="#3B82F6" radius={[8, 8, 0, 0]} />
        <Bar dataKey="Reuniones Realizadas" fill="#10B981" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
