"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClientExecutive, MeetingDetail as Meeting } from "./types";
import { PeithoContext, usePeitho } from "./context";
import ResearchButton from "./ResearchButton";
import MeetingExecutiveSelect from "./MeetingExecutiveSelect";
import DetailTabs from "./DetailTabs";
import AnalysisView from "./AnalysisView";
import PreBriefView from "./PreBriefView";
import MeetingVideoPlayer from "./MeetingVideoPlayer";
import CollapsibleSection from "./CollapsibleSection";

// Detalle de una reunión de Peitho dentro del portal de BullsEye — versión
// "cliente" de peitho-frontend/app/reuniones/[id]/page.tsx (sin las acciones
// internas de Peitho: reprocesar, reanalizar, borrar, compartir, corregir
// cliente/contacto). Era un Server Component; acá carga por el proxy.

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Agendada",
  captured: "Capturada",
  analyzed: "Analizada",
  no_show: "No show",
};

function formatDate(value: string | null): string {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </div>
  );
}

export default function MeetingDetail({ meetingId, onBack }: { meetingId: string; onBack: () => void }) {
  const ctx = usePeitho();
  const { api } = ctx;
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [executives, setExecutives] = useState<ClientExecutive[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api(`/meetings/${meetingId}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      setError(data?.error ?? "No se pudo cargar la reunión");
      return;
    }
    setError(null);
    setMeeting(data);
    if (data.client_id) {
      const r = await api(`/clients/${data.client_id}/executives`);
      if (r.ok) setExecutives(await r.json());
    }
  }, [api, meetingId]);

  useEffect(() => {
    setMeeting(null);
    load();
  }, [load]);

  const back = (
    <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-700">
      ← Volver a las reuniones
    </button>
  );
  if (error) return <div className="space-y-3">{back}<p className="text-sm text-red-600">{error}</p></div>;
  if (!meeting) return <div className="space-y-3">{back}<p className="text-sm text-gray-500">Cargando reunión…</p></div>;

  const analysis = meeting.analysis;
  const preBrief = meeting.pre_brief;

  const analysisTab = !analysis ? (
    <p className="text-sm text-gray-500">Todavía no hay análisis generado para esta reunión.</p>
  ) : (
    <AnalysisView analysis={analysis} ejecutivo={meeting.ejecutivo} />
  );

  const transcriptTab = (
    <>
      {meeting.video_available && (
        <Section title="Video de la reunión">
          <p className="text-xs text-gray-400 -mt-1">Respaldo disponible por 30 días desde la fecha de la reunión.</p>
          <MeetingVideoPlayer meetingId={meeting.id} />
        </Section>
      )}
      {meeting.transcript_text ? (
        <Section title="Transcripción">
          <div className="flex items-center gap-2 text-xs text-gray-500 pb-3 border-b border-gray-50">
            <span className="font-medium text-gray-700">{meeting.ejecutivo ?? "Ejecutivo"}</span>
            <span>·</span>
            <span className="font-medium text-gray-700">{meeting.contraparte ?? "Contraparte"}</span>
          </div>
          <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans max-h-[600px] overflow-y-auto">{meeting.transcript_text}</pre>
        </Section>
      ) : (
        <p className="text-sm text-gray-500">Todavía no hay transcripción disponible para esta reunión.</p>
      )}
    </>
  );

  return (
    // refresh() del contexto recarga esta reunión (lo usan el research y el selector de ejecutivo)
    <PeithoContext.Provider value={{ ...ctx, refresh: load }}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {back}
            <h1 className="text-xl font-semibold text-gray-900 mt-2">
              {meeting.contacto_nombre ?? meeting.contraparte ?? "Reunión"}
              {(meeting.empresa_nombre ?? meeting.empresa_contraparte) ? ` — ${meeting.empresa_nombre ?? meeting.empresa_contraparte}` : ""}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {formatDate(meeting.start_time)} · {meeting.client_executive_name ?? meeting.cliente_sales_manager ?? meeting.ejecutivo ?? "—"} ·{" "}
              {STATUS_LABEL[meeting.status] ?? meeting.status}
            </p>
          </div>
          <ResearchButton
            meetingId={meeting.id}
            initialStatus={meeting.pre_brief_status}
            researchRunCount={meeting.research_run_count}
            isClient
          />
        </div>

        <Section title="Ficha del contacto">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ["Nombre", meeting.contacto_nombre],
              ["Cargo", meeting.contacto_cargo],
              ["Industria", meeting.contacto_industria],
              ["Empresa", meeting.empresa_nombre],
              ["Ejecutivo", meeting.client_executive_name ?? meeting.cliente_sales_manager],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs font-medium text-gray-500">{label}</p>
                <p className="text-gray-700">{value ?? "—"}</p>
              </div>
            ))}
          </div>
          {meeting.client_id && (
            <MeetingExecutiveSelect meetingId={meeting.id} executives={executives} initialExecutiveId={meeting.client_executive_id} />
          )}
        </Section>

        {meeting.participantes && meeting.participantes.length > 0 && (
          <Section title="Participantes de la llamada">
            <div className="space-y-2.5">
              {(() => {
                const total = meeting.participantes!.reduce((sum, p) => sum + p.palabras, 0);
                return meeting.participantes!.map((p, i) => {
                  const pct = total > 0 ? Math.round((p.palabras / total) * 100) : 0;
                  return (
                    <div key={p.nombre} className="flex items-center gap-3 text-sm">
                      <span className="w-44 shrink-0 truncate text-gray-700">
                        {p.nombre}
                        {i === 0 && (
                          <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(98,224,216,0.15)", color: "#251762" }}>
                            Ejecutivo detectado
                          </span>
                        )}
                      </span>
                      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#251762" }} />
                      </div>
                      <span className="w-10 shrink-0 text-right text-xs text-gray-400">{pct}%</span>
                    </div>
                  );
                });
              })()}
            </div>
          </Section>
        )}

        {preBrief && (
          <CollapsibleSection label="research" defaultOpen={!analysis}>
            <PreBriefView preBrief={preBrief} />
          </CollapsibleSection>
        )}

        {meeting.pre_brief_status === "failed" && (
          <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-4">
            <p className="text-sm text-red-600">El research falló — intenta de nuevo con el botón de arriba.</p>
          </div>
        )}

        {meeting.status === "no_show" ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <p className="text-sm text-gray-500">
              {analysis?.reunion_valida?.motivo ?? "No se detectó conversación en la grabación — probablemente el prospecto no llegó a la cita."}
            </p>
          </div>
        ) : !analysis && !meeting.transcript_text ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <p className="text-sm text-gray-500">
              {`Todavía no hay análisis para esta reunión (estado actual: ${STATUS_LABEL[meeting.status] ?? meeting.status}). El análisis se genera automáticamente cuando termina de grabarse la llamada.`}
            </p>
          </div>
        ) : (
          <DetailTabs
            tabs={[
              { key: "analisis", label: "Análisis", content: analysisTab },
              { key: "transcripcion", label: "Transcripción", content: transcriptTab },
            ]}
          />
        )}
      </div>
    </PeithoContext.Provider>
  );
}
