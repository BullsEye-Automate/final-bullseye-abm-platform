"use client";

import { useEffect, useState, useCallback } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconBulb,
  IconLoader2,
  IconAlertCircle,
  IconRefresh,
  IconBuilding,
  IconCalendarEvent,
  IconCheck,
  IconPhoneCall,
} from "@tabler/icons-react";

// ─── Tipos ──────────────────────────────────────────────────────────────────

type CallSignal = {
  categoria: string;
  evidencia: string;
  tipo_senal: "restriccion_temporal" | "oportunidad_futura" | "proceso_compra" | "rechazo_definitivo" | "informacion_contextual";
  periodo: string;
  certeza: "explicito" | "inferido" | "insuficiente";
  relevancia: "alta" | "media" | "baja";
  relevancia_motivo: string;
};

type MentionedCompany = {
  nombre: string;
  contexto: string;
  tipo: "competidor" | "referido" | "proveedor_actual" | "otro";
};

type SignalRow = {
  id: string;
  client_id: string;
  allo_call_id: string;
  contact_number: string | null;
  contact_name: string | null;
  contact_company: string | null;
  contact_job_title: string | null;
  call_date: string | null;
  call_duration: number | null;
  signals: CallSignal[];
  mentioned_companies: MentionedCompany[];
  top_relevance: "alta" | "media" | "baja" | null;
  recommended_action: string | null;
  follow_up_date: string | null;
  crm_summary: string | null;
  reviewed: boolean;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const RELEVANCE_META: Record<string, { label: string; bg: string; border: string; text: string }> = {
  alta: { label: "Alta", bg: "#fef2f2", border: "#fca5a5", text: "#dc2626" },
  media: { label: "Media", bg: "#fffbeb", border: "#fcd34d", text: "#d97706" },
  baja: { label: "Baja", bg: "#f9fafb", border: "#d1d5db", text: "#6b7280" },
};

const TIPO_SENAL_LABEL: Record<CallSignal["tipo_senal"], string> = {
  restriccion_temporal: "Restricción temporal",
  oportunidad_futura: "Oportunidad futura",
  proceso_compra: "Proceso de compra",
  rechazo_definitivo: "Rechazo definitivo",
  informacion_contextual: "Información contextual",
};

const ACCION_LABEL: Record<string, string> = {
  seguimiento_fecha: "Seguimiento a fecha confirmada",
  seguimiento_condicionado: "Seguimiento condicionado",
  investigacion_adicional: "Investigación adicional de la cuenta",
  cambio_interlocutor: "Cambio de interlocutor",
  descalificacion: "Descalificación comercial",
  ninguna_accion: "Sin acción",
};

const MENTIONED_TIPO_LABEL: Record<MentionedCompany["tipo"], string> = {
  competidor: "Competidor",
  referido: "Referido",
  proveedor_actual: "Proveedor actual",
  otro: "Otro",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── Página ─────────────────────────────────────────────────────────────────

export default function SenalesComercialesPage() {
  const { currentClient } = useClient();
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(true);

  const load = useCallback((clientId: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/clients/${clientId}/call-signals?reviewed=${onlyUnreviewed ? "false" : "all"}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); setSignals([]); return; }
        setSignals(d.signals ?? []);
      })
      .catch((e) => setError(e.message ?? "Error de red"))
      .finally(() => setLoading(false));
  }, [onlyUnreviewed]);

  useEffect(() => {
    if (currentClient?.id) load(currentClient.id);
  }, [currentClient?.id, load]);

  async function markReviewed(signalId: string) {
    setSignals((prev) => prev.map((s) => (s.id === signalId ? { ...s, reviewed: true } : s)));
    await fetch(`/api/clients/${currentClient?.id}/call-signals`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal_id: signalId, reviewed: true }),
    }).catch(() => {});
    if (onlyUnreviewed) setSignals((prev) => prev.filter((s) => s.id !== signalId));
  }

  if (!currentClient) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-ink-muted">Selecciona un cliente en el sidebar para ver sus señales comerciales.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label">SDR</div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconBulb size={22} style={{ color: "#62E0D8" }} /> Señales comerciales
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Detectadas por IA a partir de las llamadas de Allo realmente conectadas — ciclos de presupuesto, procesos de compra, rechazos y empresas mencionadas.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex gap-1 p-1 rounded-lg bg-[#F4F2FB]">
            <button
              onClick={() => setOnlyUnreviewed(true)}
              className="text-xs px-3 py-1.5 rounded-md transition"
              style={onlyUnreviewed ? { background: "white", color: "#251762", fontWeight: 600 } : { color: "#6B6884" }}
            >
              No revisadas
            </button>
            <button
              onClick={() => setOnlyUnreviewed(false)}
              className="text-xs px-3 py-1.5 rounded-md transition"
              style={!onlyUnreviewed ? { background: "white", color: "#251762", fontWeight: 600 } : { color: "#6B6884" }}
            >
              Todas
            </button>
          </div>
          <button
            onClick={() => currentClient?.id && load(currentClient.id)}
            disabled={loading}
            className="btn-secondary"
            title="Refrescar"
          >
            {loading ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />}
          </button>
        </div>
      </header>

      {error && (
        <div className="card border border-danger-bg text-danger-fg flex items-center gap-2 text-sm">
          <IconAlertCircle size={16} /> {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-ink-muted py-10 justify-center">
          <IconLoader2 size={22} className="animate-spin" />
          <span>Cargando señales…</span>
        </div>
      )}

      {!loading && !error && signals.length === 0 && (
        <div className="card text-center py-12 text-ink-muted text-sm">
          {onlyUnreviewed
            ? "No hay señales pendientes de revisar para este cliente."
            : "Todavía no hay señales analizadas para este cliente — se generan automáticamente a partir de las llamadas conectadas de Allo."}
        </div>
      )}

      <div className="space-y-3">
        {signals.map((s) => {
          const relevance = RELEVANCE_META[s.top_relevance ?? "baja"];
          return (
            <div key={s.id} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink">{s.contact_name || "Contacto sin identificar"}</span>
                    {s.contact_company && (
                      <span className="text-sm text-ink-muted flex items-center gap-1">
                        <IconBuilding size={13} /> {s.contact_company}
                      </span>
                    )}
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full border"
                      style={{ background: relevance.bg, borderColor: relevance.border, color: relevance.text }}
                    >
                      Relevancia {relevance.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-ink-muted flex-wrap">
                    {s.contact_job_title && <span>{s.contact_job_title}</span>}
                    <span className="flex items-center gap-1">
                      <IconPhoneCall size={12} /> {formatDate(s.call_date)} · {formatDuration(s.call_duration)}
                    </span>
                  </div>
                </div>
                {!s.reviewed && (
                  <button
                    onClick={() => markReviewed(s.id)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#E5E2F0] hover:bg-gray-50 transition shrink-0"
                  >
                    <IconCheck size={13} /> Marcar revisada
                  </button>
                )}
              </div>

              {s.signals.length > 0 && (
                <div className="space-y-2">
                  {s.signals.map((sig, i) => (
                    <div key={i} className="bg-[#F9F8FC] rounded-lg px-3 py-2">
                      <div className="flex items-center gap-1.5 flex-wrap text-xs mb-1">
                        <span className="font-semibold text-ink">{sig.categoria}</span>
                        <span className="px-1.5 py-0.5 rounded bg-white border border-[#E5E2F0] text-ink-muted">
                          {TIPO_SENAL_LABEL[sig.tipo_senal]}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-white border border-[#E5E2F0] text-ink-muted capitalize">
                          {sig.certeza}
                        </span>
                        {sig.periodo && (
                          <span className="px-1.5 py-0.5 rounded bg-white border border-[#E5E2F0] text-ink-muted flex items-center gap-1">
                            <IconCalendarEvent size={11} /> {sig.periodo}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-ink italic">"{sig.evidencia}"</p>
                      <p className="text-xs text-ink-subtle mt-0.5">{sig.relevancia_motivo}</p>
                    </div>
                  ))}
                </div>
              )}

              {s.mentioned_companies.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-ink-muted">Empresas mencionadas:</span>
                  {s.mentioned_companies.map((c, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#1D4ED8]" title={c.contexto}>
                      {c.nombre} · {MENTIONED_TIPO_LABEL[c.tipo]}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-[#F1EEF7]">
                <div className="text-xs">
                  <span className="font-semibold text-ink-muted">Acción sugerida: </span>
                  <span className="text-ink">{ACCION_LABEL[s.recommended_action ?? ""] ?? s.recommended_action}</span>
                  {s.follow_up_date && (
                    <span className="text-ink-muted"> · seguimiento {new Date(s.follow_up_date).toLocaleDateString("es-CL")}</span>
                  )}
                </div>
              </div>

              {s.crm_summary && (
                <div className="bg-[#EDF9F8] rounded-lg px-3 py-2 text-sm text-[#0F6E56]">
                  {s.crm_summary}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
