"use client";

import { Meeting } from "../page";

const REALIZADO_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  Si: { bg: "bg-green-100", text: "text-green-700", label: "Realizado" },
  No: { bg: "bg-red-100", text: "text-red-700", label: "No Realizado" },
  Pendiente: { bg: "bg-yellow-100", text: "text-yellow-700", label: "Pendiente" },
  Reagendar: { bg: "bg-purple-100", text: "text-purple-700", label: "Reagendar" },
};

export default function MesEnCurso({ meetings }: { meetings: Meeting[] }) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // Reuniones del mes actual
  const reunionesDelMes = meetings.filter((m) => {
    if (!m.fecha_reunion) return false;
    const date = new Date(m.fecha_reunion);
    return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
  });

  // Reuniones del mes anterior (para comparar)
  const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const lastYear = currentMonth === 0 ? currentYear - 1 : currentYear;
  const reunionesDelMesPasado = meetings.filter((m) => {
    if (!m.fecha_reunion) return false;
    const date = new Date(m.fecha_reunion);
    return date.getMonth() === lastMonth && date.getFullYear() === lastYear;
  });

  // Contar por etapas
  const countByStatus = (dataset: Meeting[]) => ({
    si: dataset.filter((m) => m.realizado === "Si").length,
    no: dataset.filter((m) => m.realizado === "No").length,
    pendiente: dataset.filter((m) => m.realizado === "Pendiente").length,
    reagendar: dataset.filter((m) => m.realizado === "Reagendar").length,
  });

  const currentCounts = countByStatus(reunionesDelMes);
  const previousCounts = countByStatus(reunionesDelMesPasado);

  const totalCurrent = Object.values(currentCounts).reduce((a, b) => a + b, 0);
  const totalPrevious = Object.values(previousCounts).reduce((a, b) => a + b, 0);

  // Calcular % de crecimiento
  const growthPercent =
    totalPrevious === 0
      ? totalCurrent > 0
        ? 100
        : 0
      : ((totalCurrent - totalPrevious) / totalPrevious) * 100;

  const growthTrend = growthPercent > 0 ? "up" : growthPercent < 0 ? "down" : "flat";

  const statusArray = [
    { key: "si", label: "Realizado", count: currentCounts.si, color: REALIZADO_COLORS.Si },
    { key: "no", label: "No Realizado", count: currentCounts.no, color: REALIZADO_COLORS.No },
    {
      key: "pendiente",
      label: "Pendiente",
      count: currentCounts.pendiente,
      color: REALIZADO_COLORS.Pendiente,
    },
    {
      key: "reagendar",
      label: "Reagendar",
      count: currentCounts.reagendar,
      color: REALIZADO_COLORS.Reagendar,
    },
  ];

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Mes en Curso</h2>
          <p className="text-sm text-gray-500 mt-1">
            {now.toLocaleDateString("es-MX", { month: "long", year: "numeric" })}
          </p>
        </div>

        {/* Indicador de crecimiento */}
        <div
          className={`px-3 py-2 rounded-lg text-sm font-medium ${
            growthTrend === "up"
              ? "bg-green-100 text-green-700"
              : growthTrend === "down"
              ? "bg-red-100 text-red-700"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          {growthTrend === "up" ? "↑" : growthTrend === "down" ? "↓" : "→"}{" "}
          {Math.abs(growthPercent).toFixed(1)}% vs mes pasado
        </div>
      </div>

      {/* Total */}
      <div className="mb-6 p-4 bg-gradient-to-r from-purple-50 to-purple-100 rounded-xl border border-purple-200">
        <p className="text-sm text-purple-700 font-medium">Total de Reuniones</p>
        <p className="text-3xl font-bold text-purple-900 mt-1">{totalCurrent}</p>
      </div>

      {/* Desglose por etapas */}
      <div className="grid grid-cols-4 gap-4">
        {statusArray.map((status) => (
          <div key={status.key} className={`${status.color.bg} rounded-xl p-4 text-center`}>
            <p className={`text-xs font-medium ${status.color.text} uppercase tracking-wide`}>
              {status.label}
            </p>
            <p className={`text-2xl font-bold ${status.color.text} mt-2`}>{status.count}</p>
            {totalCurrent > 0 && (
              <p className="text-xs text-gray-600 mt-1">
                {((status.count / totalCurrent) * 100).toFixed(0)}%
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
