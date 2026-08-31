"use client";

import { IconX } from "@tabler/icons-react";
import OrigenPieYDetalle, { type MeetingDetail } from "./OrigenPieYDetalle";

interface ModalOrigenReunionesProps {
  isOpen: boolean;
  title: string;
  reuniones: MeetingDetail[];
  onClose: () => void;
}

export default function ModalOrigenReuniones({ isOpen, title, reuniones, onClose }: ModalOrigenReunionesProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between gap-4 p-6 border-b shrink-0">
          <div>
            <h2 className="font-semibold text-lg">{title}</h2>
            <p className="text-sm text-ink-muted">Distribución por Origen — {reuniones.length} reuniones</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition">
            <IconX size={20} />
          </button>
        </div>

        <div className="overflow-auto flex-1 p-6">
          <OrigenPieYDetalle reuniones={reuniones} />
        </div>
      </div>
    </div>
  );
}
