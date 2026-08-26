"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import ModalReuniones from "./ModalReuniones";

interface Reunion {
  id: string;
  sdr_nombre: string;
  fecha_reunion: string;
  prospecto_nombre?: string;
  empresa?: string;
  client_id?: string;
}

interface ResultadosDia {
  fecha: string;
  llamadas_realizadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
  reuniones?: Reunion[];
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
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedFecha, setSelectedFecha] = useState<string>("");
  const [selectedReuniones, setSelectedReuniones] = useState<Reunion[]>([]);

  const chartData = useMemo(() => {
    let processed: Array<{
      fecha: string;
      fechaKey: string;
      Llamadas: number;
      "Reuniones Agendadas": number;
      reuniones: Reunion[];
    }> = [];

    if (granularidad === "dia") {
      processed = data.map((d) => ({
        fecha: new Date(d.fecha).toLocaleDateString("es-MX", {
          month: "short",
          day: "numeric",
        }),
        fechaKey: d.fecha,
        Llamadas: d.llamadas_realizadas,
        "Reuniones Agendadas": d.reuniones_agendadas,
        reuniones: d.reuniones || [],
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
        fechaKey: week,
        Llamadas: items.reduce((sum, i) => sum + i.llamadas_realizadas, 0),
        "Reuniones Agendadas": items.reduce((sum, i) => sum + i.reuniones_agendadas, 0),
        reuniones: items.flatMap((i) => i.reuniones || []),
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
        fechaKey: month,
        Llamadas: items.reduce((sum, i) => sum + i.llamadas_realizadas, 0),
        "Reuniones Agendadas": items.reduce((sum, i) => sum + i.reuniones_agendadas, 0),
        reuniones: items.flatMap((i) => i.reuniones || []),
      }));
    }

    return processed.filter((d) => d.Llamadas > 0 || d["Reuniones Agendadas"] > 0);
  }, [data, granularidad]);

  const handleReunionesClick = (dataPoint: any) => {
    setSelectedFecha(dataPoint.fecha);
    setSelectedReuniones(dataPoint.reuniones || []);
    setModalOpen(true);
  };

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

  const toggleSeries = (key: string) => {
    const newVisible = new Set(visibleSeries);
    if (newVisible.has(key)) {
      newVisible.delete(key);
    } else {
      newVisible.add(key);
    }
    setVisibleSeries(newVisible);
  };

  const LEGEND_ITEMS = [
    { key: "Llamadas", color: "#251762" },
    { key: "Reuniones Agendadas", color: "#3B82F6" },
  ];

  const CustomLegend = () => (
    <div className="flex items-center justify-center gap-6 pt-5 text-xs">
      {LEGEND_ITEMS.map((item) => {
        const active = visibleSeries.has(item.key);
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => toggleSeries(item.key)}
            className="flex items-center gap-1.5 cursor-pointer select-none"
            style={{ opacity: active ? 1 : 0.4 }}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: item.color }}
            />
            <span className="text-gray-700">{item.key}</span>
          </button>
        );
      })}
    </div>
  );

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
    <>
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
            <BarChart
              data={chartData}
              margin={{ top: 30, right: 30, left: 0, bottom: 5 }}
              onClick={(state: any) => {
                if (
                  state?.activeTooltipIndex !== undefined &&
                  visibleSeries.has("Reuniones Agendadas")
                ) {
                  const dataPoint = chartData[state.activeTooltipIndex];
                  if (dataPoint && dataPoint["Reuniones Agendadas"] > 0) {
                    handleReunionesClick(dataPoint);
                  }
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="fecha" stroke="#6b7280" style={{ fontSize: "12px" }} />
              <YAxis stroke="#6b7280" style={{ fontSize: "12px" }} />
              <Tooltip content={<CustomTooltip />} />
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
                  onClick={(data: any) => {
                    if (data["Reuniones Agendadas"] > 0) {
                      handleReunionesClick(data);
                    }
                  }}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
          <CustomLegend />
        </div>
      </div>

      {/* Modal de reuniones */}
      <ModalReuniones
        isOpen={modalOpen}
        fecha={selectedFecha}
        reuniones={selectedReuniones}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
