"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { IconLoader2, IconAlertCircle, IconCalendar } from "@tabler/icons-react";
import ResultadosView, { Meeting } from "../../ResultadosView";

type Data = {
  client_name: string | null;
  client_logo_url: string | null;
  desde: string | null;
  hasta: string | null;
  meetings: Meeting[];
};

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

function rangoLabel(desde: string | null, hasta: string | null) {
  if (desde && hasta) return `${formatDate(desde)} – ${formatDate(hasta)}`;
  if (desde) return `Desde ${formatDate(desde)}`;
  if (hasta) return `Hasta ${formatDate(hasta)}`;
  return "Todo el historial";
}

export default function ResultadosCompartidoPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData]       = useState<Data | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/resultados-compartidos/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Error al cargar el dashboard"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F6FC]">
        <div className="flex items-center gap-3 text-[#251762]">
          <IconLoader2 size={22} className="animate-spin" />
          <span className="font-medium">Cargando resultados…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F6FC]">
        <div className="bg-white rounded-2xl shadow-sm border border-[#E5E2F0] px-8 py-10 max-w-md text-center space-y-3">
          <IconAlertCircle size={36} className="mx-auto text-red-400" />
          <p className="font-semibold text-[#251762] text-lg">{error ?? "Link no encontrado"}</p>
          <p className="text-sm text-gray-500">Si crees que esto es un error, contacta a quien te compartió este link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F6FC]">
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Resultados {data.client_name ? `— ${data.client_name}` : ""}</h1>
            <p className="text-sm text-gray-500 mt-1">Resumen de reuniones y feedback</p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 bg-white text-gray-600">
            <IconCalendar size={14} className="text-gray-400" />
            {rangoLabel(data.desde, data.hasta)}
          </div>
        </div>

        <ResultadosView meetings={data.meetings} loading={false} shared />
      </div>
    </div>
  );
}
