"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  IconPhone,
  IconChevronRight,
  IconUser,
  IconClock,
  IconLoader2,
  IconRefresh,
  IconCloud,
  IconSparkles,
  IconArrowUp,
  IconArrowDown,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Call = {
  id: string;
  client_id: string | null;
  hubspot_call_id: string;
  contact_name: string | null;
  company_name: string | null;
  direction: "OUTBOUND" | "INBOUND" | null;
  duration_ms: number | null;
  disposition: string | null;
  disposition_label: string | null;
  notes_raw: string | null;
  notes_clean: string | null;
  called_at: string | null;
  hubspot_owner_id: string | null;
  sdr_name: string | null;
  ai_score: number | null;
  ai_outcome: string | null;
  ai_outcome_detail: string | null;
  ai_is_real_conversation: boolean | null;
  ai_summary: string | null;
  ai_next_steps: string | null;
  analyzed_at: string | null;
  created_at: string;
};

type Stats = {
  total: number;
  avg_duration_ms: number;
  avg_score: number;
  real_conversations: number;
  interested: number;
  unique_contacts: number;
  unique_companies: number;
  analyzed_count: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Formatea milisegundos a string legible (ej: "2m 46s", "47s")
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// Formatea ISO a hora en formato 12h (ej: "03:27 p.m.")
function formatTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Agrupa llamadas por fecha en español (ej: "LUNES, 25 DE MAYO DE 2026")
function groupCallsByDate(
  calls: Call[]
): { dateLabel: string; calls: Call[] }[] {
  const map = new Map<string, Call[]>();
  for (const c of calls) {
    const d = c.called_at ? new Date(c.called_at) : new Date(c.created_at);
    const key = d
      .toLocaleDateString("es-CL", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
      .toUpperCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  return Array.from(map.entries()).map(([dateLabel, calls]) => ({
    dateLabel,
    calls,
  }));
}

// Retorna color según score del SDR
function scoreColor(score: number): string {
  if (score >= 7) return "#16a34a";
  if (score >= 5) return "#d97706";
  return "#dc2626";
}

// ─── Colores de outcome ───────────────────────────────────────────────────────

const OUTCOME_COLORS: Record<string, string> = {
  Interesado: "bg-green-100 text-green-800",
  Objeción: "bg-orange-100 text-orange-800",
  "Buzón de voz": "bg-slate-100 text-slate-700",
  "No contesta": "bg-gray-100 text-gray-600",
  "No decide": "bg-yellow-100 text-yellow-800",
  "No aplica": "bg-red-100 text-red-700",
  Ganado: "bg-emerald-100 text-emerald-800",
};

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string | number;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div className="card py-3 px-4 flex flex-col gap-1">
      <div className="text-[10px] font-semibold tracking-widest text-ink-muted uppercase">
        {label}
      </div>
      <div
        className="text-2xl font-bold"
        style={{ color: valueColor ?? "#251762" }}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

function OutcomeBadge({
  outcome,
  detail,
}: {
  outcome: string;
  detail?: string | null;
}) {
  const cls = OUTCOME_COLORS[outcome] ?? "bg-gray-100 text-gray-600";
  const label = detail ? `${outcome} · ${detail}` : outcome;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function DirectionBadge({ direction }: { direction: string | null }) {
  const isOutbound = direction === "OUTBOUND";
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded"
      style={
        isOutbound
          ? { background: "rgba(98,224,216,0.15)", color: "#0F6E56" }
          : { background: "rgba(74,222,128,0.15)", color: "#15803d" }
      }
    >
      {isOutbound ? (
        <IconArrowUp size={11} />
      ) : (
        <IconArrowDown size={11} />
      )}
      {isOutbound ? "SALIENTE" : "ENTRANTE"}
    </span>
  );
}

function CallCard({ call }: { call: Call }) {
  return (
    <div className="card py-3 px-4 hover:bg-gray-50 cursor-pointer transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Hora */}
          <span className="text-xs text-ink-muted w-20 shrink-0 pt-0.5">
            {formatTime(call.called_at)}
          </span>

          {/* Contenido principal */}
          <div className="flex-1 min-w-0">
            {/* Fila 1: nombre, empresa, dirección, duración, SDR */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-ink">
                {call.contact_name ?? "Desconocido"}
              </span>
              {call.company_name && (
                <span className="text-ink-muted">· {call.company_name}</span>
              )}
              <DirectionBadge direction={call.direction} />
              {call.duration_ms != null && call.duration_ms > 0 && (
                <span className="flex items-center gap-1 text-xs text-ink-muted">
                  <IconClock size={12} />
                  {formatDuration(call.duration_ms)}
                </span>
              )}
              {call.sdr_name && (
                <span className="flex items-center gap-1 text-xs text-ink-muted">
                  <IconUser size={12} />
                  {call.sdr_name}
                </span>
              )}
            </div>

            {/* Fila 2: outcome badge + score */}
            {call.ai_outcome && (
              <div className="flex items-center gap-3 mt-1.5">
                <OutcomeBadge
                  outcome={call.ai_outcome}
                  detail={call.ai_outcome_detail}
                />
                {call.ai_score != null && (
                  <span className="text-xs text-ink-muted">
                    ★ SDR {call.ai_score}/10
                  </span>
                )}
              </div>
            )}

            {/* Resumen IA */}
            {call.ai_summary && (
              <p className="text-sm text-ink mt-2 leading-relaxed">
                {call.ai_summary}
              </p>
            )}

            {/* Próximo paso */}
            {call.ai_next_steps && (
              <p className="text-sm mt-1">
                <span className="font-medium" style={{ color: "#62E0D8" }}>
                  Próximo paso:
                </span>{" "}
                <span className="text-ink">{call.ai_next_steps}</span>
              </p>
            )}

            {/* Notas raw si no hay análisis */}
            {!call.ai_summary && call.notes_clean && (
              <p className="text-sm text-ink-muted mt-1 line-clamp-2">
                {call.notes_clean}
              </p>
            )}
          </div>
        </div>

        <IconChevronRight
          size={16}
          className="text-ink-muted shrink-0 mt-0.5 ml-2"
        />
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function LlamadasPage() {
  const { currentClient } = useClient();

  const [calls, setCalls] = useState<Call[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [sdrNames, setSdrNames] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    synced: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filtros locales del cliente
  const [filterOutcome, setFilterOutcome] = useState<string>("");
  const [filterSdr, setFilterSdr] = useState<string>("");

  // Carga de datos desde Supabase
  const loadCalls = useCallback(async (clientId: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ client_id: clientId });
      const res = await fetch(`/api/hubspot/calls?${params}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error cargando llamadas");
      } else {
        setCalls(data.calls ?? []);
        setStats(data.stats ?? null);
        setOutcomes(data.outcomes ?? []);
        setSdrNames(data.sdr_names ?? []);
      }
    } catch {
      setError("Error de red al cargar llamadas");
    }
    setLoading(false);
  }, []);

  // Auto-sync al montar si no hay datos en Supabase
  const autoSync = useCallback(
    async (clientId: string) => {
      // Primero intenta cargar desde Supabase
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ client_id: clientId });
        const res = await fetch(`/api/hubspot/calls?${params}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (res.ok && (data.calls ?? []).length > 0) {
          setCalls(data.calls ?? []);
          setStats(data.stats ?? null);
          setOutcomes(data.outcomes ?? []);
          setSdrNames(data.sdr_names ?? []);
          setLoading(false);
          return;
        }
      } catch {
        // Si falla, continúa con el sync automático
      }
      setLoading(false);

      // Si no hay datos, sincroniza automáticamente desde HubSpot
      setSyncing(true);
      try {
        const syncRes = await fetch("/api/hubspot/calls/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId }),
        });
        const syncData = await syncRes.json();
        if (syncRes.ok) {
          setSyncResult({ synced: syncData.synced, total: syncData.total });
          await loadCalls(clientId);
        }
      } catch {
        setError("Error al sincronizar con HubSpot");
      }
      setSyncing(false);
    },
    [loadCalls]
  );

  useEffect(() => {
    if (currentClient?.id) {
      autoSync(currentClient.id);
    }
  }, [currentClient?.id, autoSync]);

  // Sincronización manual desde HubSpot
  async function handleSync() {
    if (!currentClient?.id) return;
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const res = await fetch("/api/hubspot/calls/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: currentClient.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncResult({ synced: data.synced, total: data.total });
        await loadCalls(currentClient.id);
      } else {
        setError(data.error ?? "Error al sincronizar");
      }
    } catch {
      setError("Error de red al sincronizar");
    }
    setSyncing(false);
  }

  // Análisis de llamadas pendientes con IA
  async function handleAnalyze() {
    if (!currentClient?.id) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/hubspot/calls/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: currentClient.id, limit: 10 }),
      });
      const data = await res.json();
      if (res.ok) {
        await loadCalls(currentClient.id);
      } else {
        setError(data.error ?? "Error al analizar llamadas");
      }
    } catch {
      setError("Error de red al analizar");
    }
    setAnalyzing(false);
  }

  // Filtrado local del array de llamadas
  const filteredCalls = useMemo((): Call[] => {
    return calls.filter((c: Call) => {
      if (filterOutcome && c.ai_outcome !== filterOutcome) return false;
      if (filterSdr && c.sdr_name !== filterSdr) return false;
      return true;
    });
  }, [calls, filterOutcome, filterSdr]);

  const groupedByDate = useMemo(
    () => groupCallsByDate(filteredCalls),
    [filteredCalls]
  );

  // Métricas derivadas para la stats bar
  const convRate =
    stats && stats.total > 0
      ? Math.round((stats.real_conversations / stats.total) * 100)
      : 0;

  const interestedPct =
    stats && stats.unique_contacts > 0
      ? Math.round((stats.interested / stats.unique_contacts) * 100)
      : 0;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="label">SDR</div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <IconPhone size={24} />
            Llamadas
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Se sincronizan solas con HubSpot al abrir. Análisis con IA:
            respuesta del cliente + evaluación del SDR.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Refrescar desde Supabase */}
          <button
            onClick={() => currentClient?.id && loadCalls(currentClient.id)}
            disabled={loading}
            className="btn-secondary"
            title="Refrescar desde Supabase"
          >
            {loading ? (
              <IconLoader2 size={15} className="animate-spin" />
            ) : (
              <IconRefresh size={15} />
            )}
            Refrescar
          </button>

          {/* Sincronizar desde HubSpot */}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn-secondary"
            title="Sincronizar llamadas desde HubSpot"
          >
            {syncing ? (
              <IconLoader2 size={15} className="animate-spin" />
            ) : (
              <IconCloud size={15} />
            )}
            Sincronizar HubSpot
          </button>

          {/* Analizar pendientes con IA */}
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="btn-primary"
            title="Analizar llamadas pendientes con IA"
          >
            {analyzing ? (
              <IconLoader2 size={15} className="animate-spin" />
            ) : (
              <IconSparkles size={15} />
            )}
            Analizar pendientes
          </button>
        </div>
      </header>

      {/* Banner resultado del sync */}
      {syncResult && (
        <div
          className="text-sm text-ink-muted border-l-4 pl-3 py-1"
          style={{ borderColor: "#62E0D8" }}
        >
          Sync OK · {syncResult.total} escaneadas · {syncResult.synced}{" "}
          guardadas
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card border border-red-200 text-red-700 text-sm px-4 py-2">
          {error}
        </div>
      )}

      {/* Sin cliente seleccionado */}
      {!currentClient && (
        <div className="card text-ink-muted text-sm">
          Selecciona un cliente en el selector de arriba para ver sus llamadas.
        </div>
      )}

      {/* Stats bar — 5 tarjetas horizontales */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          <StatCard
            label="LLAMADAS"
            value={stats.total}
            sub={`${stats.unique_contacts} contactos · ${stats.unique_companies} empresas`}
          />
          <StatCard
            label="DURACIÓN PROMEDIO"
            value={
              stats.avg_duration_ms > 0
                ? formatDuration(stats.avg_duration_ms)
                : "—"
            }
            sub={`${stats.analyzed_count} analizadas`}
          />
          <StatCard
            label="SCORE SDR PROMEDIO"
            value={
              stats.avg_score > 0 ? `${stats.avg_score.toFixed(1)}/10` : "—"
            }
            sub="según IA"
            valueColor={
              stats.avg_score > 0 ? scoreColor(stats.avg_score) : undefined
            }
          />
          <StatCard
            label="TASA DE CONVERSACIÓN"
            value={`${convRate}%`}
            sub={`${stats.real_conversations}/${stats.total} conversaron`}
          />
          <StatCard
            label="INTERESADOS"
            value={stats.interested}
            sub={`${interestedPct}% de los contactos`}
          />
        </div>
      )}

      {/* Filtros */}
      {(outcomes.length > 0 || sdrNames.length > 0) && (
        <div className="flex gap-3">
          <select
            className="input text-sm py-1.5"
            value={filterOutcome}
            onChange={(e) => setFilterOutcome(e.target.value)}
          >
            <option value="">Todas las respuestas</option>
            {outcomes.map((o: string) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>

          <select
            className="input text-sm py-1.5"
            value={filterSdr}
            onChange={(e) => setFilterSdr(e.target.value)}
          >
            <option value="">Todos los SDR</option>
            {sdrNames.map((s: string) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Estado de carga / sync */}
      {(loading || syncing) && (
        <div className="flex items-center gap-3 text-ink-muted py-10 justify-center">
          <IconLoader2 size={22} className="animate-spin" />
          <span>
            {syncing ? "Sincronizando con HubSpot…" : "Cargando llamadas…"}
          </span>
        </div>
      )}

      {/* Lista de llamadas agrupadas por fecha */}
      {!loading && !syncing && currentClient && (
        <>
          {filteredCalls.length === 0 ? (
            <div className="card text-ink-muted text-sm flex items-center gap-2">
              <IconPhone size={18} className="shrink-0 opacity-40" />
              No hay llamadas registradas. Presiona &ldquo;Sincronizar
              HubSpot&rdquo; para importar las llamadas.
            </div>
          ) : (
            <div className="space-y-4">
              {groupedByDate.map(
                ({ dateLabel, calls: dayCalls }: { dateLabel: string; calls: Call[] }) => (
                  <div key={dateLabel}>
                    {/* Cabecera de fecha */}
                    <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide py-2 border-b border-[#E5E2F0] mb-1">
                      {dateLabel}
                    </div>
                    {/* Llamadas del día */}
                    <div className="space-y-1">
                      {dayCalls.map((call: Call) => (
                        <CallCard key={call.id} call={call} />
                      ))}
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
