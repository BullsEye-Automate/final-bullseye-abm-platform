"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { IconCheck, IconAlertCircle, IconMessageCheck, IconCalendar, IconExternalLink } from "@tabler/icons-react";

type ClientData = {
  id: string;
  name: string;
  logo_url: string | null;
};

type Meeting = {
  id: string;
  empresa: string;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  fecha_reunion: string | null;
  realizado: string;
  feedback_status: "pendiente" | "con_feedback";
  feedback_token: string;
  sdr_nombre: string | null;
};

export default function FeedbackClientePage() {
  const { token } = useParams() as { token: string };
  const [client, setClient] = useState<ClientData | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/feedback-cliente/${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setNotFound(true); setLoading(false); return; }
        setClient(data.client);
        setMeetings(data.meetings ?? []);
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Cargando…</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h1 className="text-xl font-semibold text-gray-800">Link inválido</h1>
          <p className="text-gray-500 text-sm mt-2">Este enlace no existe o expiró.</p>
        </div>
      </div>
    );
  }

  const pendientes  = meetings.filter(m => m.feedback_status === "pendiente");
  const conFeedback = meetings.filter(m => m.feedback_status === "con_feedback");

  const fmtFecha = (f: string | null) =>
    f ? new Date(f + "T12:00:00").toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" }) : null;

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-2xl font-bold tracking-tight mb-1">
            <span style={{ color: "#251762" }}>Bulls</span>
            <span style={{ color: "#62E0D8" }}>Eye</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mt-5">
            Feedback de reuniones
          </h1>
          {client && (
            <p className="text-sm text-gray-500 mt-1">{client.name}</p>
          )}
          <p className="text-xs text-gray-400 mt-3 max-w-sm mx-auto">
            Aquí puedes completar el feedback de cada reunión realizada. Haz clic en "Llenar encuesta" para comenzar.
          </p>
        </div>

        {/* Estadísticas rápidas */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-center gap-3">
            <IconAlertCircle size={22} className="text-amber-500 shrink-0" />
            <div>
              <div className="text-2xl font-bold text-amber-700">{pendientes.length}</div>
              <div className="text-xs text-amber-600 mt-0.5">Pendientes de feedback</div>
            </div>
          </div>
          <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4 flex items-center gap-3">
            <IconMessageCheck size={22} className="text-teal-500 shrink-0" />
            <div>
              <div className="text-2xl font-bold text-teal-700">{conFeedback.length}</div>
              <div className="text-xs text-teal-600 mt-0.5">Con feedback completado</div>
            </div>
          </div>
        </div>

        {/* Reuniones pendientes */}
        {pendientes.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3 flex items-center gap-2">
              <IconAlertCircle size={15} className="text-amber-500" />
              Pendientes de feedback ({pendientes.length})
            </h2>
            <div className="space-y-3">
              {pendientes.map(m => (
                <div key={m.id}
                  className="bg-white rounded-2xl border-2 border-amber-100 shadow-sm p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{m.empresa}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {[m.contacto_nombre, m.contacto_cargo].filter(Boolean).join(" · ")}
                    </p>
                    {m.fecha_reunion && (
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                        <IconCalendar size={11} /> {fmtFecha(m.fecha_reunion)}
                      </p>
                    )}
                  </div>
                  <a
                    href={`/encuesta/${m.feedback_token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition hover:opacity-90"
                    style={{ background: "#251762" }}>
                    Llenar encuesta
                    <IconExternalLink size={13} />
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reuniones con feedback */}
        {conFeedback.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3 flex items-center gap-2">
              <IconCheck size={15} className="text-teal-500" />
              Con feedback completado ({conFeedback.length})
            </h2>
            <div className="space-y-2">
              {conFeedback.map(m => (
                <div key={m.id}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-4 opacity-75">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-700 truncate">{m.empresa}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {[m.contacto_nombre, m.contacto_cargo].filter(Boolean).join(" · ")}
                    </p>
                    {m.fecha_reunion && (
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                        <IconCalendar size={11} /> {fmtFecha(m.fecha_reunion)}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-teal-50 text-teal-700 border border-teal-100">
                    <IconCheck size={12} /> Completado
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {meetings.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <IconCalendar size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No hay reuniones realizadas aún</p>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-12 pb-6">
          BullsEye · Plataforma de prospección B2B
        </p>
      </div>
    </div>
  );
}
