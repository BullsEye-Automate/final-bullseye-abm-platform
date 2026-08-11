"use client";

import { useMemo } from "react";
import { Meeting } from "../page";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface HeatmapData {
  dia: number;
  diaLabel: string;
  hora: number;
  horaLabel: string;
  total: number;
  exitosas: number;
  tasaExito: number;
}

const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default function GraficoHorariosYDias({ meetings }: { meetings: Meeting[] }) {
  const heatmapData = useMemo(() => {
    // Matriz: [dia][hora]
    const matrix: Record<number, Record<number, { total: number; exitosas: number }>> = {};

    for (let dia = 0; dia < 7; dia++) {
      matrix[dia] = {};
      for (let hora = 6; hora < 21; hora++) {
        matrix[dia][hora] = { total: 0, exitosas: 0 };
      }
    }

    // Procesar reuniones
    meetings.forEach((meeting) => {
      if (!meeting.fecha_reunion) return;

      const date = new Date(meeting.fecha_reunion);
      const dia = date.getDay();
      const hora = date.getHours();

      // Skip Sunday (día 0) - solo lunes a sábado
      if (dia === 0) return;

      // Solo contar horas válidas (6am a 8pm)
      if (hora >= 6 && hora < 21) {
        if (!matrix[dia][hora]) {
          matrix[dia][hora] = { total: 0, exitosas: 0 };
        }
        matrix[dia][hora].total++;

        if (meeting.realizado === "Si") {
          matrix[dia][hora].exitosas++;
        }
      }
    });

    // Convertir a array para el gráfico
    const data: HeatmapData[] = [];
    for (let dia = 0; dia < 7; dia++) {
      for (let hora = 6; hora < 21; hora++) {
        const { total, exitosas } = matrix[dia][hora];
        const tasaExito = total > 0 ? (exitosas / total) * 100 : 0;
        data.push({
          dia,
          diaLabel: DIAS_SEMANA[dia],
          hora,
          horaLabel: `${String(hora).padStart(2, "0")}:00`,
          total,
          exitosas,
          tasaExito,
        });
      }
    }

    return data;
  }, [meetings]);

  const getColorByRate = (rate: number) => {
    if (rate === 0) return "#f3f4f6"; // gris muy claro
    if (rate < 25) return "#fecaca"; // rojo claro
    if (rate < 50) return "#fbbf24"; // amarillo
    if (rate < 75) return "#a3e635"; // verde claro
    return "#22c55e"; // verde oscuro
  };

  const maxTotal = Math.max(...heatmapData.map((d) => d.total), 1);

  // Agrupar por día para mostrar mejor (lunes a sábado, sin domingo)
  const dayGroups = DIAS_SEMANA.map((dia, idx) => ({
    dia: idx,
    label: dia,
    data: heatmapData.filter((d) => d.dia === idx),
  })).filter((group) => group.dia !== 0);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload as HeatmapData;
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200 text-xs">
          <p className="font-semibold text-gray-900">
            {data.diaLabel} {data.horaLabel}
          </p>
          <p className="text-gray-600">Total: {data.total} reuniones</p>
          <p className="text-green-600">Exitosas: {data.exitosas}</p>
          <p className="font-medium text-gray-900 mt-1">Tasa de éxito: {data.tasaExito.toFixed(1)}%</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">Mejor Horario y Día para Agendar</h2>

      {heatmapData.filter((d) => d.total > 0).length === 0 ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          No hay datos disponibles
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-6 gap-1 mb-6">
            {dayGroups.map((group) => (
              <div key={group.dia} className="min-w-0">
                <div className="text-center mb-2">
                  <p className="text-xs font-semibold text-gray-700">{group.label}</p>
                </div>
                <div className="space-y-0.5">
                  {group.data.map((item) => (
                    <div
                      key={`${item.dia}-${item.hora}`}
                      className="w-full h-8 rounded text-center flex items-center justify-center cursor-pointer transition-all hover:ring-2 hover:ring-offset-1 hover:ring-blue-400"
                      style={{ backgroundColor: getColorByRate(item.tasaExito) }}
                      title={`${item.horaLabel}: ${item.exitosas}/${item.total} (${item.tasaExito.toFixed(1)}%)`}
                    >
                      {item.total > 0 && (
                        <span className="text-xs font-semibold text-gray-800">{item.total}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Leyenda */}
          <div className="flex items-center justify-center gap-4 text-xs mt-6 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#f3f4f6" }}></div>
              <span className="text-gray-600">Sin datos</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fecaca" }}></div>
              <span className="text-gray-600">0-25%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fbbf24" }}></div>
              <span className="text-gray-600">25-50%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#a3e635" }}></div>
              <span className="text-gray-600">50-75%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#22c55e" }}></div>
              <span className="text-gray-600">75-100%</span>
            </div>
          </div>

          <p className="text-xs text-gray-500 mt-4 text-center">
            Los colores más verdes indican mejor tasa de éxito. El número en cada celda indica
            cuántas reuniones se agendaron en ese horario.
          </p>
        </div>
      )}
    </div>
  );
}
