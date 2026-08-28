"use client";

import { useState } from "react";
import { IconX, IconArrowLeft } from "@tabler/icons-react";
import MarkdownLite from "@/components/MarkdownLite";
import type { ScoreCallSummary } from "./TablaScoresSdr";

interface ModalScoreLlamadasProps {
  isOpen: boolean;
  sdrNombre: string;
  metricKey: string; // "puntaje_total" o el label de una categoría del DESGLOSE
  metricLabel: string;
  calls: ScoreCallSummary[];
  onClose: () => void;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
}

export default function ModalScoreLlamadas({
  isOpen,
  sdrNombre,
  metricKey,
  metricLabel,
  calls,
  onClose,
}: ModalScoreLlamadasProps) {
  const [selectedCall, setSelectedCall] = useState<ScoreCallSummary | null>(null);

  if (!isOpen) return null;

  const getMetricValue = (c: ScoreCallSummary): number | null =>
    metricKey === "puntaje_total" ? c.puntaje_total : c.desglose[metricKey] ?? null;

  const handleClose = () => {
    setSelectedCall(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between gap-4 p-6 border-b shrink-0">
          <div>
            {selectedCall && (
              <button
                onClick={() => setSelectedCall(null)}
                className="text-xs text-brand flex items-center gap-1 mb-1 hover:underline"
              >
                <IconArrowLeft size={12} /> Volver al listado
              </button>
            )}
            <h2 className="font-semibold text-lg">
              {selectedCall ? "Detalle de la llamada" : `${metricLabel} — ${sdrNombre}`}
            </h2>
            {!selectedCall && (
              <p className="text-sm text-ink-muted">
                {calls.length} llamada{calls.length !== 1 ? "s" : ""} analizada{calls.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <button onClick={handleClose} className="p-1 hover:bg-gray-100 rounded-lg transition shrink-0">
            <IconX size={20} />
          </button>
        </div>

        <div className="overflow-auto flex-1 p-6">
          {selectedCall ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-ink-muted font-medium mb-0.5">Contacto</div>
                  <div className="font-medium">{selectedCall.contact_name ?? "Sin identificar"}</div>
                  <div className="text-xs text-gray-500 font-mono">{selectedCall.contact_number}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted font-medium mb-0.5">Cliente / Fecha</div>
                  <div>{selectedCall.cliente_nombre}</div>
                  <div className="text-xs text-gray-500">{formatDateTime(selectedCall.date)}</div>
                </div>
              </div>

              {selectedCall.has_recording && (
                <audio controls preload="none" className="w-full" src={`/api/allo/calls/${selectedCall.id}/recording`}>
                  Tu navegador no soporta audio.
                </audio>
              )}

              <MarkdownLite text={selectedCall.summary} className="text-sm" />
            </div>
          ) : calls.length === 0 ? (
            <p className="text-center text-ink-muted py-8">No hay llamadas para esta selección</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-gray-700">Fecha</th>
                  <th className="px-4 py-2 text-left font-semibold text-gray-700">Contacto</th>
                  <th className="px-4 py-2 text-left font-semibold text-gray-700">Cliente</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-700">{metricLabel}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {calls.map((c, idx) => {
                  const val = getMetricValue(c);
                  return (
                    <tr key={c.id} className={idx % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"}>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-700">{formatDateTime(c.date)}</td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-900">{c.contact_name ?? "Sin identificar"}</div>
                        <div className="text-xs text-gray-500 font-mono">{c.contact_number}</div>
                      </td>
                      <td className="px-4 py-2 text-gray-700">{c.cliente_nombre}</td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">
                        {val == null ? "N/A" : Math.round(val)}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <button onClick={() => setSelectedCall(c)} className="text-xs text-brand hover:underline">
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
