"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
  IconFilter,
  IconX,
} from "@tabler/icons-react";

// ─── Tipos ──────────────────────────────────────────────────────────────────

type CallSignalCategory =
  | "ciclo_presupuesto"
  | "evaluacion_proveedores"
  | "contrato_vigente"
  | "licitacion_compras"
  | "proyecto_postergado"
  | "necesidad_futura"
  | "cambio_organizacional"
  | "rechazo_definitivo";

type CallSignal = {
  categoria: CallSignalCategory;
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

type MentionedTechnology = {
  nombre: string;
  contexto: string;
};

type SignalRow = {
  id: string;
  client_id: string;
  allo_call_id: string;
  contact_number: string | null;
  contact_name: string | null;
  contact_company: string | null;
  contact_job_title: string | null;
  industry: string | null;
  call_date: string | null;
  call_duration: number | null;
  signals: CallSignal[];
  mentioned_companies: MentionedCompany[];
  mentioned_technologies: MentionedTechnology[];
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

const CATEGORY_LABELS: Record<CallSignalCategory, string> = {
  ciclo_presupuesto: "Ciclo de presupuesto",
  evaluacion_proveedores: "Evaluación de proveedores",
  contrato_vigente: "Contrato vigente / renovación",
  licitacion_compras: "Licitación / proceso de compras",
  proyecto_postergado: "Proyecto postergado",
  necesidad_futura: "Necesidad futura",
  cambio_organizacional: "Cambio organizacional",
  rechazo_definitivo: "Rechazo definitivo",
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS) as [CallSignalCategory, string][];

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

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  next.has(value) ? next.delete(value) : next.add(value);
  return next;
}

// ─── Página ─────────────────────────────────────────────────────────────────

export default function SenalesComercialesPage() {
  const { currentClient } = useClient();
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<Set<CallSignalCategory>>(new Set());
  const [industryFilter, setIndustryFilter] = useState<Set<string>>(new Set());

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

  // Industrias presentes en los datos cargados — el filtro de industria es
  // dinámico (no un enum fijo como categoría) porque Claude la infiere en
  // texto libre corto.
  const industriesPresent = useMemo(() => {
    const set = new Set<string>();
    for (const s of signals) if (s.industry) set.add(s.industry);
    return Array.from(set).sort();
  }, [signals]);

  const categoriesPresent = useMemo(() => {
    const set = new Set<CallSignalCategory>();
    for (const s of signals) for (const sig of s.signals) set.add(sig.categoria);
    return set;
  }, [signals]);

  const filteredSignals = useMemo(() => {
    return signals.filter((s) => {
      if (categoryFilter.size > 0 && !s.signals.some((sig) => categoryFilter.has(sig.categoria))) return false;
      if (industryFilter.size > 0 && (!s.industry || !industryFilter.has(s.industry))) return false;
      return true;
    });
  }, [signals, categoryFilter, industryFilter]);

  const hasActiveFilters = categoryFilter.size > 0 || industryFilter.size > 0;

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
            Detectadas por IA a partir de las llamadas de Allo realmente conectadas — ciclos de presupuesto, procesos de compra, rechazos, tecnologías y empresas mencionadas.
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

      {!loading && signals.length > 0 && (
        <div className="card p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
            <IconFilter size={13} /> Filtrar por tipo de señal
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_OPTIONS.filter(([value]) => categoriesPresent.has(value)).map(([value, label]) => {
              const active = categoryFilter.has(value);
              return (
                <button
                  key={value}
                  onClick={() => setCategoryFilter((prev) => toggleInSet(prev, value))}
                  className="text-xs px-2.5 py-1 rounded-full border transition"
                  style={active ? { background: "#251762", color: "white", borderColor: "#251762" } : { background: "white", color: "#6B6884", borderColor: "#E5E2F0" }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {industriesPresent.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted pt-1">
                <IconFilter size={13} /> Filtrar por industria del prospecto
              </div>
              <div className="flex flex-wrap gap-1.5">
                {industriesPresent.map((ind) => {
                  const active = industryFilter.has(ind);
                  return (
                    <button
                      key={ind}
                      onClick={() => setIndustryFilter((prev) => toggleInSet(prev, ind))}
                      className="text-xs px-2.5 py-1 rounded-full border transition"
                      style={active ? { background: "#251762", color: "white", borderColor: "#251762" } : { background: "white", color: "#6B6884", borderColor: "#E5E2F0" }}
                    >
                      {ind}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {hasActiveFilters && (
            <button
              onClick={() => { setCategoryFilter(new Set()); setIndustryFilter(new Set()); }}
              className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink pt-1"
            >
              <IconX size={12} /> Limpiar filtros
            </button>
          )}
        </div>
      )}

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

      {!loading && signals.length > 0 && filteredSignals.length === 0 && (
        <div className="card text-center py-12 text-ink-muted text-sm">Sin resultados para estos filtros.</div>
      )}

      <div className="space-y-3">
        {filteredSignals.map((s) => {
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
                    {s.industry && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#F1EEF7] text-[#251762]">{s.industry}</span>
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
                        <span className="font-semibold text-ink">{CATEGORY_LABELS[sig.categoria] ?? sig.categoria}</span>
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

              {s.mentioned_technologies.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-ink-muted">Tecnologías mencionadas:</span>
                  {s.mentioned_technologies.map((t, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-[#F5F3FF] text-[#6D28D9]" title={t.contexto}>
                      {t.nombre}
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
