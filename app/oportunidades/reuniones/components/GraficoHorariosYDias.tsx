"use client";

import { useMemo } from "react";
import { Meeting } from "../page";

interface HeatmapData {
  dia: number;
  diaLabel: string;
  hora: number;
  horaLabel: string;
  total: number;
  exitosas: number;
  tasaExito: number;
}

const DIAS_SEMANA_LABORAL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const DIA_INDEX_MAP: Record<string, number> = {
  "Lunes": 1,
  "Martes": 2,
  "Miércoles": 3,
  "Jueves": 4,
  "Viernes": 5,
  "Sábado": 6,
};

export default function GraficoHorariosYDias({ meetings }: { meetings: Meeting[] }) {
  const heatmapData = useMemo(() => {
    const matrix: Record<number, Record<number, { total: number; exitosas: number }>> = {};

    for (let dia = 1; dia <= 6; dia++) {
      matrix[dia] = {};
      for (let hora = 6; hora < 21; hora++) {
        matrix[dia][hora] = { total: 0, exitosas: 0 };
      }
    }

    meetings.forEach((meeting) => {
      if (!meeting.fecha_reunion) return;

      const dateString = meeting.fecha_reunion.split("T")[0];
      const timeString = meeting.fecha_reunion.split("T")[1]?.split("+")[0] || "00:00:00";
      const hora = parseInt(timeString.split(":")[0], 10);

      const date = new Date(dateString);
      const dia = date.getDay();

      if (dia === 0 || dia > 6) return; // Skip Sunday and invalid days

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

    const data: HeatmapData[] = [];
    for (let dia = 1; dia <= 6; dia++) {
      for (let hora = 6; hora < 21; hora++) {
        const { total, exitosas } = matrix[dia][hora];
        const tasaExito = total > 0 ? (exitosas / total) * 100 : 0;
        const diaLabel = DIAS_SEMANA_LABORAL[dia - 1];
        data.push({
          dia,
          diaLabel,
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
    if (rate === 0) return "#f3f4f6";
    if (rate < 25) return "#FEE2E2"; // Rojo muy claro
    if (rate < 50) return "#FFEDD5"; // Naranja muy claro
    if (rate < 75) return "#D1FAE5"; // Verde claro
    return "#6EE7B7"; // Verde BullsEye style
  };

  const dayGroups = DIAS_SEMANA_LABORAL.map((dia, idx) => ({
    dia: idx + 1,
    label: dia,
    data: heatmapData.filter((d) => d.dia === idx + 1),
  }));

  const horasConDatos = useMemo(() => {
    const horas = new Set<number>();
    heatmapData.forEach((d) => {
      if (d.total > 0) {
        horas.add(d.hora);
      }
    });
    return Array.from(horas).sort((a, b) => a - b);
  }, [heatmapData]);

  const stats = useMemo(() => {
    const totalReuniones = heatmapData.reduce((sum, d) => sum + d.total, 0);
    const totalExitosas = heatmapData.reduce((sum, d) => sum + d.exitosas, 0);
    const mejorDia = dayGroups.reduce((best, group) => {
      const groupTotal = group.data.reduce((sum, d) => sum + d.total, 0);
      const groupExitosas = group.data.reduce((sum, d) => sum + d.exitosas, 0);
      const groupRate = groupTotal > 0 ? (groupExitosas / groupTotal) * 100 : 0;
      const bestRate = best.groupTotal > 0 ? (best.groupExitosas / best.groupTotal) * 100 : 0;
      return groupRate > bestRate ? { ...group, groupTotal, groupExitosas } : best;
    }, { label: "—", groupTotal: 0, groupExitosas: 0 });

    const mejorHora = heatmapData.reduce((best, item) => {
      return item.exitosas > best.exitosas ? item : best;
    }, heatmapData[0]);

    return {
      totalReuniones,
      totalExitosas,
      tasaGlobal: totalReuniones > 0 ? (totalExitosas / totalReuniones) * 100 : 0,
      mejorDia: mejorDia.label,
      mejorHora: mejorHora.horaLabel,
    };
  }, [heatmapData, dayGroups]);

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Mejor Horario y Día para Agendar</h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="p-3 bg-[#62E0D8]/10 rounded-lg border border-[#62E0D8]/20">
            <p className="text-xs text-gray-600 uppercase tracking-wide">Total Reuniones</p>
            <p className="text-2xl font-bold text-[#62E0D8]">{stats.totalReuniones}</p>
          </div>
          <div className="p-3 bg-green-100 rounded-lg border border-green-200">
            <p className="text-xs text-gray-600 uppercase tracking-wide">Tasa Exitosa</p>
            <p className="text-2xl font-bold text-green-700">{stats.tasaGlobal.toFixed(1)}%</p>
          </div>
          <div className="p-3 bg-blue-100 rounded-lg border border-blue-200">
            <p className="text-xs text-gray-600 uppercase tracking-wide">Mejor Día</p>
            <p className="text-lg font-bold text-blue-700">{stats.mejorDia}</p>
          </div>
          <div className="p-3 bg-purple-100 rounded-lg border border-purple-200">
            <p className="text-xs text-gray-600 uppercase tracking-wide">Mejor Hora</p>
            <p className="text-lg font-bold text-purple-700">{stats.mejorHora}</p>
          </div>
        </div>
      </div>

      {heatmapData.filter((d) => d.total > 0).length === 0 ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          No hay datos disponibles
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex gap-4 min-w-fit">
            {/* Eje Y (Horas) */}
            <div className="flex flex-col pt-10">
              {horasConDatos.map((hora) => (
                <div
                  key={`hora-${hora}`}
                  className="h-12 flex items-center justify-end pr-2 text-xs font-medium text-gray-600"
                >
                  {String(hora).padStart(2, "0")}:00
                </div>
              ))}
            </div>

            {/* Grid de celdas */}
            <div className="flex gap-1 pb-4">
              {dayGroups.map((group) => (
                <div key={group.dia} className="flex flex-col">
                  {/* Encabezado del día */}
                  <div className="h-10 flex items-center justify-center">
                    <p className="text-xs font-bold text-[#251762]">{group.label}</p>
                  </div>

                  {/* Celdas de horarios */}
                  <div className="space-y-1">
                    {group.data
                      .filter((item) => horasConDatos.includes(item.hora))
                      .map((item) => (
                        <div
                          key={`${item.dia}-${item.hora}`}
                          className="w-16 h-12 rounded-lg flex items-center justify-center cursor-pointer transition-all hover:ring-2 hover:ring-[#62E0D8] hover:shadow-md"
                          style={{ backgroundColor: getColorByRate(item.tasaExito) }}
                          title={`${group.label} ${item.horaLabel}: ${item.exitosas}/${item.total} (${item.tasaExito.toFixed(1)}%)`}
                        >
                          {item.total > 0 && (
                            <div className="text-center">
                              <p className="text-sm font-bold text-gray-900">{item.total}</p>
                              <p className="text-xs text-gray-600">{item.tasaExito.toFixed(0)}%</p>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Leyenda */}
          <div className="flex items-center justify-center gap-4 text-xs mt-8 pt-4 border-t border-gray-200">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#f3f4f6" }}></div>
              <span className="text-gray-600">Sin datos</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#FEE2E2" }}></div>
              <span className="text-gray-600">0-25%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#FFEDD5" }}></div>
              <span className="text-gray-600">25-50%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#D1FAE5" }}></div>
              <span className="text-gray-600">50-75%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#6EE7B7" }}></div>
              <span className="text-gray-600">75-100%</span>
            </div>
          </div>

          <p className="text-xs text-gray-500 mt-4 text-center">
            Colores más verdes = mejor tasa de éxito. Número grande = cantidad de reuniones.
            Número pequeño = porcentaje de éxito en ese horario.
          </p>
        </div>
      )}
    </div>
  );
}
