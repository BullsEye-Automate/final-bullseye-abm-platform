"use client";

import { useState } from "react";
import { Meeting } from "../page";
import { IconX } from "@tabler/icons-react";

const STATUS_INFO = {
  Si: {
    bg: "bg-[#62E0D8]/10",
    border: "border-[#62E0D8]",
    text: "text-[#62E0D8]",
    label: "Realizado",
    dark: "#62E0D8"
  },
  No: {
    bg: "bg-[#EF5350]/10",
    border: "border-[#EF5350]",
    text: "text-[#EF5350]",
    label: "No Realizado",
    dark: "#EF5350"
  },
  Pendiente: {
    bg: "bg-[#FFA726]/10",
    border: "border-[#FFA726]",
    text: "text-[#FFA726]",
    label: "Pendiente",
    dark: "#FFA726"
  },
  Reagendar: {
    bg: "bg-[#AB47BC]/10",
    border: "border-[#AB47BC]",
    text: "text-[#AB47BC]",
    label: "Reagendar",
    dark: "#AB47BC"
  },
};

interface ModalData {
  status: "Si" | "No" | "Pendiente" | "Reagendar";
  meetings: Meeting[];
}

export default function MesEnCurso({ meetings }: { meetings: Meeting[] }) {
  const [modalData, setModalData] = useState<ModalData | null>(null);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const reunionesDelMes = meetings.filter((m) => {
    if (!m.fecha_reunion) return false;
    const date = new Date(m.fecha_reunion);
    return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
  });

  const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const lastYear = currentMonth === 0 ? currentYear - 1 : currentYear;
  const reunionesDelMesPasado = meetings.filter((m) => {
    if (!m.fecha_reunion) return false;
    const date = new Date(m.fecha_reunion);
    return date.getMonth() === lastMonth && date.getFullYear() === lastYear;
  });

  const countByStatus = (dataset: Meeting[]) => ({
    Si: dataset.filter((m) => m.realizado === "Si").length,
    No: dataset.filter((m) => m.realizado === "No").length,
    Pendiente: dataset.filter((m) => m.realizado === "Pendiente").length,
    Reagendar: dataset.filter((m) => m.realizado === "Reagendar").length,
  });

  const currentCounts = countByStatus(reunionesDelMes);
  const previousCounts = countByStatus(reunionesDelMesPasado);

  const totalCurrent = Object.values(currentCounts).reduce((a, b) => a + b, 0);
  const totalPrevious = Object.values(previousCounts).reduce((a, b) => a + b, 0);

  const growthPercent =
    totalPrevious === 0
      ? totalCurrent > 0 ? 100 : 0
      : ((totalCurrent - totalPrevious) / totalPrevious) * 100;

  const growthTrend = growthPercent > 0 ? "up" : growthPercent < 0 ? "down" : "flat";

  const statusArray = [
    { key: "Si", count: currentCounts.Si },
    { key: "No", count: currentCounts.No },
    { key: "Pendiente", count: currentCounts.Pendiente },
    { key: "Reagendar", count: currentCounts.Reagendar },
  ];

  const openModal = (status: "Si" | "No" | "Pendiente" | "Reagendar") => {
    const statusMeetings = reunionesDelMes.filter((m) => m.realizado === status);
    setModalData({ status, meetings: statusMeetings });
  };

  return (
    <>
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-[#251762]">Mes en Curso</h2>
            <p className="text-sm text-gray-500 mt-1">
              {now.toLocaleDateString("es-MX", { month: "long", year: "numeric" })}
            </p>
          </div>

          <div
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${
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

        <div className="mb-8 p-6 bg-[#251762]/5 border-2 border-[#62E0D8] rounded-xl">
          <p className="text-sm text-[#62E0D8] font-semibold uppercase tracking-wide">Total de Reuniones</p>
          <p className="text-5xl font-bold text-[#251762] mt-2">{totalCurrent}</p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {statusArray.map((status) => {
            const info = STATUS_INFO[status.key as keyof typeof STATUS_INFO];
            return (
              <button
                key={status.key}
                onClick={() => openModal(status.key as any)}
                className={`${info.bg} border-2 ${info.border} rounded-xl p-6 text-center transition-all hover:shadow-lg cursor-pointer`}
              >
                <p className={`text-xs font-bold ${info.text} uppercase tracking-wider`}>
                  {info.label}
                </p>
                <p className={`text-4xl font-bold ${info.text} mt-3`}>{status.count}</p>
                {totalCurrent > 0 && (
                  <p className="text-xs text-gray-600 mt-2">
                    {((status.count / totalCurrent) * 100).toFixed(0)}%
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Modal */}
      {modalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-[#251762] to-[#3a2a7d] px-8 py-6 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold text-[#62E0D8]">
                  {STATUS_INFO[modalData.status].label}
                </h3>
                <p className="text-[#62E0D8]/70 text-sm mt-1">Mes actual</p>
              </div>
              <div className="text-right">
                <p className="text-4xl font-bold text-[#62E0D8]">{modalData.meetings.length}</p>
                <p className="text-[#62E0D8]/70 text-xs">reuniones</p>
              </div>
              <button
                onClick={() => setModalData(null)}
                className="ml-4 p-2 hover:bg-[#62E0D8]/20 rounded-lg transition-colors"
              >
                <IconX size={24} className="text-[#62E0D8]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {modalData.meetings.length === 0 ? (
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
                      {modalData.meetings.map((m, idx) => (
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
