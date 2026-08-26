"use client";

import { IconX } from "@tabler/icons-react";

interface Reunion {
  id: string;
  sdr_nombre: string;
  fecha_reunion: string;
  prospecto_nombre?: string;
  empresa?: string;
  client_name?: string;
}

interface ModalReunionesProps {
  isOpen: boolean;
  fecha: string;
  reuniones: Reunion[];
  onClose: () => void;
}

export default function ModalReuniones({ isOpen, fecha, reuniones, onClose }: ModalReunionesProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 p-6 border-b sticky top-0 bg-white">
          <div>
            <h2 className="font-semibold text-lg">Reuniones Agendadas</h2>
            <p className="text-sm text-ink-muted">{fecha}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition"
          >
            <IconX size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {reuniones.length === 0 ? (
            <p className="text-center text-ink-muted py-8">No hay reuniones para este día</p>
          ) : (
            <div className="space-y-4">
              {reuniones.map((reunion) => (
                <div
                  key={reunion.id}
                  className="border rounded-lg p-4 hover:bg-gray-50 transition"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-ink-muted font-medium">SDR</div>
                      <div className="font-semibold text-gray-900">{reunion.sdr_nombre}</div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-muted font-medium">Cliente</div>
                      <div className="font-semibold text-gray-900">{reunion.client_name || "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-muted font-medium">Prospecto</div>
                      <div className="font-semibold text-gray-900">{reunion.prospecto_nombre || "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-muted font-medium">Empresa</div>
                      <div className="font-semibold text-gray-900">{reunion.empresa || "N/A"}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-xs text-ink-muted font-medium">Fecha de Reunión</div>
                      <div className="font-semibold text-gray-900">
                        {new Date(reunion.fecha_reunion).toLocaleDateString("es-MX", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
