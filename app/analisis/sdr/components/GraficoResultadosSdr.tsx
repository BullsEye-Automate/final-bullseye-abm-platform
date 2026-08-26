"use client";

import { useMemo, useState } from "react";
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
  const [visibleSeries, setVisibleSeries] = useState<Set<string>>(new Set(["Llamadas", "Reuniones Agendadas"]));

  const chartData = useMemo(() => {
    let processed: Array<{ fecha: string; Llamadas: number; "Reuniones Agendadas": number }> = [];

    if (granularidad === "dia") {
      processed = data.map((d) => ({
        fecha: new Date(d.fecha).toLocaleDateString("es-MX", {
          month: "short",
          day: "numeric",
        }),
        Llamadas: d.llamadas_realizadas,
        "Reuniones Agendadas": d.reuniones_agendadas,
      }));
    } else if (granularidad === "semana") {
      const byWeek: Record<string, ResultadosDia[]> = {};
      for (const item of data) {
        const date = new Date(item.fecha);
        const weekStart = new Date(date);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekKey = weekStart.toISOString().split("T")[0];

        if (!byWeek[weekKey]) byWeek[weekKey] = [];
        byWeek[weekKey].push(item);
      }

      processed = Object.entries(byWeek).map(([week, items]) => ({
        fecha: `Sem ${new Date(week).toLocaleDateString("es-MX", { month: "short", day: "numeric" })}`,
        Llamadas: items.reduce((sum, i) => sum + i.llamadas_realizadas, 0),
        "Reuniones Agendadas": items.reduce((sum, i) => sum + i.reuniones_agendadas, 0),
      }));
    } else {
      const byMonth: Record<string, ResultadosDia[]> = {};
      for (const item of data) {
        const date = new Date(item.fecha);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

        if (!byMonth[monthKey]) byMonth[monthKey] = [];
        byMonth[monthKey].push(item);
      }

      processed = Object.entries(byMonth).map(([month, items]) => ({
        fecha: new Date(`${month}-01`).toLocaleDateString("es-MX", {
          month: "long",
          year: "numeric",
        }),
        Llamadas: items.reduce((sum, i) => sum + i.llamadas_realizadas, 0),
        "Reuniones Agendadas": items.reduce((sum, i) => sum + i.reuniones_agendadas, 0),
      }));
    }

    return processed.filter((d) => d.Llamadas > 0 || d["Reuniones Agendadas"] > 0);
  }, [data, granularidad]);

  const metrics = useMemo(() => {
    const llamadasValues = chartData
      .filter((d) => d.Llamadas > 0)
      .map((d) => d.Llamadas);
    const reunionesValues = chartData
      .filter((d) => d["Reuniones Agendadas"] > 0)
      .map((d) => d["Reuniones Agendadas"]);

    return {
      promedio_llamadas: llamadasValues.length > 0 ? (llamadasValues.reduce((a, b) => a + b, 0) / llamadasValues.length).toFixed(1) : "0",
      promedio_reuniones: reunionesValues.length > 0 ? (reunionesValues.reduce((a, b) => a + b, 0) / reunionesValues.length).toFixed(1) : "0",
    };
  }, [chartData]);

  const handleLegendClick = (e: any) => {
    const newVisible = new Set(visibleSeries);
    if (newVisible.has(e.value)) {
      newVisible.delete(e.value);
    } else {
      newVisible.add(e.value);
    }
    setVisibleSeries(newVisible);
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200 text-xs">
          <p className="font-semibold text-gray-900">{payload[0].payload.fecha}</p>
          {visibleSeries.has("Llamadas") && payload.some((p: any) => p.dataKey === "Llamadas") && (
            <p className="text-blue-900">📞 Llamadas: {payload.find((p: any) => p.dataKey === "Llamadas")?.value}</p>
          )}
          {visibleSeries.has("Reuniones Agendadas") && payload.some((p: any) => p.dataKey === "Reuniones Agendadas") && (
            <p className="text-blue-600">📅 Agendadas: {payload.find((p: any) => p.dataKey === "Reuniones Agendadas")?.value}</p>
          )}
        </div>
      );
    }
    return null;
  };

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        No hay datos disponibles
      </div>
    );
  }

  return (
    <div className="flex gap-6">
      {/* Métricas a la izquierda */}
      <div className="flex flex-col gap-4 min-w-fit">
        {visibleSeries.has("Llamadas") && (
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="text-xs text-gray-600 font-medium">PROMEDIO LLAMADAS</div>
            <div className="text-3xl font-bold text-blue-900 mt-1">{metrics.promedio_llamadas}</div>
          </div>
        )}
        {visibleSeries.has("Reuniones Agendadas") && (
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="text-xs text-gray-600 font-medium">PROMEDIO REUNIONES</div>
            <div className="text-3xl font-bold text-blue-600 mt-1">{metrics.promedio_reuniones}</div>
          </div>
        )}
      </div>

      {/* Gráfico */}
      <div className="flex-1">
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData} margin={{ top: 30, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="fecha" stroke="#6b7280" style={{ fontSize: "12px" }} />
            <YAxis stroke="#6b7280" style={{ fontSize: "12px" }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: "12px", paddingTop: "20px", cursor: "pointer" }}
              onClick={handleLegendClick}
            />
            {visibleSeries.has("Llamadas") && (
              <Bar
                dataKey="Llamadas"
                fill="#251762"
                radius={[8, 8, 0, 0]}
                label={{ position: "top", fill: "#251762", fontSize: 12, fontWeight: "600" }}
              />
            )}
            {visibleSeries.has("Reuniones Agendadas") && (
              <Bar
                dataKey="Reuniones Agendadas"
                fill="#3B82F6"
                radius={[8, 8, 0, 0]}
                label={{ position: "top", fill: "#3B82F6", fontSize: 12, fontWeight: "600" }}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
