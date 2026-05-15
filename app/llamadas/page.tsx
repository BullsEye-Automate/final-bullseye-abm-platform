"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  IconPhone,
  IconRefresh,
  IconAlertCircle,
  IconCloudDownload,
  IconReportAnalytics,
  IconStarFilled,
  IconArrowDownRight,
  IconArrowUpRight,
  IconChevronRight,
  IconClock,
  IconUser,
  IconBulb,
  IconLink
} from "@tabler/icons-react";
import { RANGE_LABELS, RANGE_ORDER, type RangeKey } from "@/lib/dashboardRanges";

type CallRow = {
  id: string;
  hubspot_call_id: string;
  call_timestamp: string | null;
  direction: string | null;
  duration_ms: number | null;
  disposition_label: string | null;
  status: string | null;
  owner_name: string | null;
  hubspot_owner_id: string | null;
  customer_response_category: string | null;
  customer_response_label: string | null;
  customer_response_summary: string | null;
  sdr_score_overall: number | null;
  analyzed_at: string | null;
  analysis_error: string | null;
  recommended_next_step: string | null;
  has_transcription: boolean;
  contact: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    linkedin_url: string | null;
    company: { id: string; company_name: string } | null;
  } | null;
  company: { id: string; company_name: string } | null;
};

type Kpis = {
  total_calls: number;
  total_analyzed: number;
  pending_analysis: number;
  orphan_calls: number;
  unique_contacts: number;
  unique_companies: number;
  avg_duration_sec: number;
  avg_sdr_score: number | null;
  interested_count: number;
  callbacks_count: number;
  interested_rate: number | null;
  pickup_rate_calls: number | null;
  pickup_calls_numerator: number;
  pickup_calls_denominator: number;
  pickup_rate_contacts: number | null;
  pickup_contacts_numerator: number;
  pickup_contacts_denominator: number;
};

type Owner = { hubspot_owner_id: string; name: string; calls: number };

type ListResponse = {
  range: { key: string; label: string };
  kpis: Kpis;
  calls: CallRow[];
};

const RESPONSE_FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "Todas las respuestas" },
  { key: "interested", label: "Interesado" },
  { key: "callback_requested", label: "Pidió callback" },
  { key: "objection_price", label: "Objeción · Precio" },
  { key: "objection_timing", label: "Objeción · Timing" },
  { key: "objection_no_need", label: "Objeción · No lo necesita" },
  { key: "objection_existing_solution", label: "Objeción · Ya tiene solución" },
  { key: "objection_authority", label: "Objeción · No decide" },
  { key: "not_interested", label: "No interesado" },
  { key: "no_engagement", label: "Sin engagement" },
  { key: "voicemail", label: "Buzón de voz" },
  { key: "gatekeeper", label: "Filtrado por gatekeeper" },
  { key: "wrong_number", label: "Número equivocado" },
  { key: "other", label: "Otro" }
];

export default function LlamadasPage() {
  const [range, setRange] = useState<RangeKey | "all">("this_month");
  const [response, setResponse] = useState<string>("");
  const [owner, setOwner] = useState<string>("");
  const [owners, setOwners] = useState<Owner[]>([]);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ range });
    if (response) params.set("response", response);
    if (owner) params.set("owner", owner);
    try {
      const res = await fetch(`/api/calls?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        setData(null);
      } else {
        setData(json);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [range, response, owner]);

  useEffect(() => {
    load();
  }, [load]);

  // Lista de owners para el filtro (fetch una vez)
  useEffect(() => {
    fetch("/api/calls/owners")
      .then((r) => r.json())
      .then((j) => setOwners(j.owners ?? []))
      .catch(() => {});
  }, []);

  async function postJson<T>(
    path: string,
    body: unknown
  ): Promise<{ ok: boolean; status: number; data: T | null; raw?: string; error?: string }> {
    let res: Response;
    try {
      res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {})
      });
    } catch (err) {
      return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : "Network error" };
    }
    const text = await res.text();
    try {
      const json = JSON.parse(text) as T;
      return { ok: res.ok, status: res.status, data: json };
    } catch {
      // El backend devolvió HTML (típicamente Vercel timeout). Surface el snippet.
      const snippet = text.slice(0, 240).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return {
        ok: false,
        status: res.status,
        data: null,
        raw: text,
        error: snippet || `HTTP ${res.status}`
      };
    }
  }

  async function runSync() {
    setSyncing(true);
    setSyncMsg(null);
    const r = await postJson<{
      ok: boolean;
      scanned: number;
      upserted: number;
      errors?: Array<{ stage: string; message: string }>;
      error?: string;
    }>("/api/calls/sync", { since_days: 30, analyze: false });
    if (!r.ok || !r.data) {
      setSyncMsg(`Error sync: ${r.error ?? r.data?.error ?? `HTTP ${r.status}`}`);
    } else {
      const j = r.data;
      const errSuffix = j.errors && j.errors.length > 0 ? ` · errores: ${j.errors[0].message}` : "";
      setSyncMsg(`Sync OK · ${j.scanned} escaneadas · ${j.upserted} guardadas${errSuffix}`);
      load();
    }
    setSyncing(false);
  }

  async function runLinkOrphans() {
    setLinking(true);
    setLinkMsg(null);
    const r = await postJson<{
      ok: boolean;
      scanned: number;
      fetched_from_hubspot: number;
      linked: number;
      by_strategy: { wecad_id: number; hubspot_id: number; linkedin: number; email: number };
      imported: number;
      imported_companies: number;
      still_orphan: number;
      errors?: Array<{ stage: string; message: string }>;
      error?: string;
    }>("/api/calls/link-orphans", { limit: 200, import_unmatched: true });
    if (!r.ok || !r.data) {
      setLinkMsg(`Error vinculación: ${r.error ?? r.data?.error ?? `HTTP ${r.status}`}`);
    } else {
      const j = r.data;
      const strat = j.by_strategy;
      const matchParts = [
        strat.wecad_id > 0 && `${strat.wecad_id} por wecad_id`,
        strat.hubspot_id > 0 && `${strat.hubspot_id} por hubspot_id`,
        strat.linkedin > 0 && `${strat.linkedin} por LinkedIn`,
        strat.email > 0 && `${strat.email} por email`
      ]
        .filter(Boolean)
        .join(", ");
      const importParts =
        j.imported > 0
          ? ` · importados desde HubSpot ${j.imported} contactos${
              j.imported_companies > 0 ? ` y ${j.imported_companies} empresas` : ""
            }`
          : "";
      setLinkMsg(
        `Vincular · ${j.scanned} huérfanas · ${j.linked} vinculadas` +
          (matchParts ? ` (${matchParts})` : "") +
          importParts +
          (j.still_orphan > 0 ? ` · quedan ${j.still_orphan} sin resolver` : "")
      );
      load();
    }
    setLinking(false);
  }

  async function runAnalyze() {
    setAnalyzing(true);
    setAnalyzeMsg(null);
    const r = await postJson<{
      ok: boolean;
      processed: number;
      analyzed: number;
      failed: number;
      remaining: number;
      errors?: Array<{ id: string; message: string }>;
      error?: string;
    }>("/api/calls/analyze-pending", { limit: 20, chunk_size: 5 });
    if (!r.ok || !r.data) {
      setAnalyzeMsg(`Error análisis: ${r.error ?? r.data?.error ?? `HTTP ${r.status}`}`);
    } else {
      const j = r.data;
      const errSuffix = j.errors && j.errors.length > 0 ? ` · primer error: ${j.errors[0].message}` : "";
      setAnalyzeMsg(
        `Análisis · procesadas ${j.processed} · OK ${j.analyzed} · fallaron ${j.failed} · quedan ${j.remaining}${errSuffix}`
      );
      load();
    }
    setAnalyzing(false);
  }

  const grouped = useMemo(() => groupByDay(data?.calls ?? []), [data]);

  return (
    <div className="space-y-6">
      <Header
        range={range}
        onRangeChange={setRange}
        onRefresh={load}
        loading={loading}
        onSync={runSync}
        syncing={syncing}
        onAnalyze={runAnalyze}
        analyzing={analyzing}
        pendingAnalysis={data?.kpis.pending_analysis ?? 0}
        onLinkOrphans={runLinkOrphans}
        linking={linking}
        orphanCount={data?.kpis.orphan_calls ?? 0}
      />

      {syncMsg && (
        <div className="card text-sm" style={{ borderLeft: "4px solid #185FA5" }}>
          {syncMsg}
        </div>
      )}
      {linkMsg && (
        <div className="card text-sm" style={{ borderLeft: "4px solid #0F6E56" }}>
          {linkMsg}
        </div>
      )}
      {analyzeMsg && (
        <div className="card text-sm" style={{ borderLeft: "4px solid #3D2878" }}>
          {analyzeMsg}
        </div>
      )}
      {error && (
        <div className="card border-l-4 border-danger-fg">
          <div className="flex items-center gap-2 text-danger-fg font-medium">
            <IconAlertCircle size={16} /> {error}
          </div>
        </div>
      )}

      {data && <KpiCards kpis={data.kpis} />}

      <Filters
        response={response}
        onResponseChange={setResponse}
        owner={owner}
        onOwnerChange={setOwner}
        owners={owners}
      />

      {!loading && data && data.calls.length === 0 && (
        <div className="card text-center py-12 text-ink-muted">
          No hay llamadas en este rango. Prueba <strong>“Sincronizar HubSpot”</strong> arriba.
        </div>
      )}

      {grouped.map((g) => (
        <DayGroup key={g.day} day={g.day} calls={g.calls} />
      ))}
    </div>
  );
}

// ============================================================================

function Header({
  range,
  onRangeChange,
  onRefresh,
  loading,
  onSync,
  syncing,
  onAnalyze,
  analyzing,
  pendingAnalysis,
  onLinkOrphans,
  linking,
  orphanCount
}: {
  range: RangeKey | "all";
  onRangeChange: (k: RangeKey | "all") => void;
  onRefresh: () => void;
  loading: boolean;
  onSync: () => void;
  syncing: boolean;
  onAnalyze: () => void;
  analyzing: boolean;
  pendingAnalysis: number;
  onLinkOrphans: () => void;
  linking: boolean;
  orphanCount: number;
}) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div>
        <div className="label">SDR · Llamadas</div>
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
          <IconPhone size={26} /> Llamadas
        </h1>
        <div className="text-sm text-ink-muted mt-1">
          Sincronizadas desde HubSpot. Análisis con IA: respuesta del cliente + evaluación del SDR.
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={range}
          onChange={(e) => onRangeChange(e.target.value as RangeKey | "all")}
          className="bg-white border border-[#E5E2F0] rounded-lg px-3 py-2 text-sm"
        >
          {RANGE_ORDER.map((k) => (
            <option key={k} value={k}>
              {RANGE_LABELS[k]}
            </option>
          ))}
          <option value="all">Todas</option>
        </select>
        <Link href="/llamadas/reporte" className="btn-secondary text-sm">
          <IconReportAnalytics size={14} /> Reportería
        </Link>
        <button onClick={onRefresh} disabled={loading} className="btn-secondary text-sm">
          <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
          {loading ? "Cargando…" : "Refrescar"}
        </button>
        <button onClick={onSync} disabled={syncing} className="btn-secondary text-sm">
          <IconCloudDownload size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Sincronizando…" : "Sincronizar HubSpot"}
        </button>
        {orphanCount > 0 && (
          <button
            onClick={onLinkOrphans}
            disabled={linking}
            className="btn-secondary text-sm"
            title="Busca matches contra Supabase por wecad_id → hubspot_id → LinkedIn → email"
          >
            <IconLink size={14} className={linking ? "animate-spin" : ""} />
            {linking ? "Vinculando…" : `Vincular huérfanas (${orphanCount})`}
          </button>
        )}
        <button
          onClick={onAnalyze}
          disabled={analyzing || pendingAnalysis === 0}
          className="btn-primary text-sm"
          title={pendingAnalysis === 0 ? "No hay llamadas pendientes de análisis" : "Analiza hasta 20 por tanda"}
        >
          <IconBulb size={14} className={analyzing ? "animate-spin" : ""} />
          {analyzing
            ? "Analizando…"
            : pendingAnalysis > 0
            ? `Analizar pendientes (${pendingAnalysis})`
            : "Analizar pendientes"}
        </button>
      </div>
    </header>
  );
}

function KpiCards({ kpis }: { kpis: Kpis }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <Kpi
        label="Llamadas"
        value={String(kpis.total_calls)}
        sub={`${kpis.unique_contacts} contactos · ${kpis.unique_companies} empresas`}
      />
      <Kpi
        label="Duración promedio"
        value={formatDuration(kpis.avg_duration_sec)}
        sub={`${kpis.total_analyzed} analizadas`}
      />
      <Kpi
        label="Score SDR promedio"
        value={kpis.avg_sdr_score == null ? "—" : `${kpis.avg_sdr_score}/10`}
        sub={kpis.total_analyzed > 0 ? "según IA" : "sin análisis"}
        accent={kpis.avg_sdr_score != null && kpis.avg_sdr_score >= 7 ? "good" : kpis.avg_sdr_score != null && kpis.avg_sdr_score < 5 ? "bad" : undefined}
      />
      <Kpi
        label="Tasa pickup · llamada"
        value={kpis.pickup_rate_calls == null ? "—" : `${kpis.pickup_rate_calls}%`}
        sub={`${kpis.pickup_calls_numerator}/${kpis.pickup_calls_denominator} contestadas`}
        accent={kpis.pickup_rate_calls != null && kpis.pickup_rate_calls >= 40 ? "good" : kpis.pickup_rate_calls != null && kpis.pickup_rate_calls < 20 ? "bad" : undefined}
      />
      <Kpi
        label="Tasa pickup · contacto"
        value={kpis.pickup_rate_contacts == null ? "—" : `${kpis.pickup_rate_contacts}%`}
        sub={`${kpis.pickup_contacts_numerator}/${kpis.pickup_contacts_denominator} atendieron`}
        accent={kpis.pickup_rate_contacts != null && kpis.pickup_rate_contacts >= 50 ? "good" : kpis.pickup_rate_contacts != null && kpis.pickup_rate_contacts < 30 ? "bad" : undefined}
      />
      <Kpi
        label="Interesados"
        value={String(kpis.interested_count)}
        sub={
          kpis.interested_rate != null
            ? `${kpis.interested_rate}% del total · ${kpis.callbacks_count} callbacks`
            : `${kpis.callbacks_count} callbacks`
        }
        accent={kpis.interested_count > 0 ? "good" : undefined}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "good" | "bad";
}) {
  const color =
    accent === "good"
      ? "#0F6E56"
      : accent === "bad"
      ? "#993C1D"
      : "#1A1733";
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="text-2xl font-semibold tracking-tight mt-1" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}

function Filters({
  response,
  onResponseChange,
  owner,
  onOwnerChange,
  owners
}: {
  response: string;
  onResponseChange: (v: string) => void;
  owner: string;
  onOwnerChange: (v: string) => void;
  owners: Owner[];
}) {
  return (
    <div className="card flex flex-wrap items-center gap-3">
      <div className="text-sm text-ink-muted">Filtrar:</div>
      <select
        value={response}
        onChange={(e) => onResponseChange(e.target.value)}
        className="bg-white border border-[#E5E2F0] rounded-lg px-3 py-1.5 text-sm"
      >
        {RESPONSE_FILTERS.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        value={owner}
        onChange={(e) => onOwnerChange(e.target.value)}
        className="bg-white border border-[#E5E2F0] rounded-lg px-3 py-1.5 text-sm"
      >
        <option value="">Todos los SDRs</option>
        {owners.map((o) => (
          <option key={o.hubspot_owner_id} value={o.hubspot_owner_id}>
            {o.name} ({o.calls})
          </option>
        ))}
      </select>
    </div>
  );
}

function DayGroup({ day, calls }: { day: string; calls: CallRow[] }) {
  return (
    <div>
      <div className="label mb-2">{formatDayHeader(day)}</div>
      <div className="space-y-2">
        {calls.map((c) => (
          <CallCard key={c.id} call={c} />
        ))}
      </div>
    </div>
  );
}

function CallCard({ call }: { call: CallRow }) {
  const contactName = call.contact
    ? [call.contact.first_name, call.contact.last_name].filter(Boolean).join(" ")
    : null;
  const companyName = call.company?.company_name ?? call.contact?.company?.company_name ?? null;
  const time = call.call_timestamp ? formatTime(call.call_timestamp) : "—";
  return (
    <Link href={`/llamadas/${call.id}`} className="block">
      <div className="card hover:shadow-md transition-shadow cursor-pointer">
        <div className="flex items-start gap-4">
          <div className="text-xs text-ink-muted shrink-0 w-12 pt-1">{time}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{contactName ?? "(sin contacto vinculado)"}</span>
              {companyName && <span className="text-ink-muted text-sm">· {companyName}</span>}
              {call.direction && (
                <span
                  className="chip text-[10px] uppercase tracking-wide"
                  style={{
                    background: call.direction === "OUTBOUND" ? "#EEEDFE" : "#E6F4EF",
                    color: call.direction === "OUTBOUND" ? "#3D2878" : "#0F6E56"
                  }}
                >
                  {call.direction === "OUTBOUND" ? <IconArrowUpRight size={10} className="inline mr-0.5" /> : <IconArrowDownRight size={10} className="inline mr-0.5" />}
                  {call.direction === "OUTBOUND" ? "Saliente" : "Entrante"}
                </span>
              )}
              {call.disposition_label && (
                <span className="chip text-[10px] bg-canvas text-ink-muted">{call.disposition_label}</span>
              )}
              <span className="text-xs text-ink-muted flex items-center gap-1">
                <IconClock size={11} />
                {formatDuration(Math.round((call.duration_ms ?? 0) / 1000))}
              </span>
              {call.owner_name && (
                <span className="text-xs text-ink-muted flex items-center gap-1">
                  <IconUser size={11} /> {call.owner_name}
                </span>
              )}
            </div>

            {call.customer_response_label && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span
                  className="chip text-xs"
                  style={{ background: responseColor(call.customer_response_category), color: "#fff" }}
                >
                  {call.customer_response_label}
                </span>
                {call.sdr_score_overall != null && (
                  <span
                    className="chip text-xs inline-flex items-center gap-1"
                    style={{
                      background:
                        call.sdr_score_overall >= 7
                          ? "#E6F4EF"
                          : call.sdr_score_overall < 5
                          ? "#FCEDE5"
                          : "#F4F2FB",
                      color:
                        call.sdr_score_overall >= 7
                          ? "#0F6E56"
                          : call.sdr_score_overall < 5
                          ? "#993C1D"
                          : "#1A1733"
                    }}
                  >
                    <IconStarFilled size={10} /> SDR {call.sdr_score_overall}/10
                  </span>
                )}
                {call.has_transcription && (
                  <span className="chip text-[10px] bg-[#EEEDFE] text-[#3D2878]">transcripción</span>
                )}
                {!call.analyzed_at && !call.analysis_error && (
                  <span className="chip text-[10px] bg-canvas text-ink-muted">sin analizar</span>
                )}
                {call.analysis_error && (
                  <span className="chip text-[10px] bg-[#FCEDE5] text-[#993C1D]">error análisis</span>
                )}
              </div>
            )}

            {call.customer_response_summary && (
              <div className="text-sm text-ink-muted mt-2 line-clamp-2">
                {call.customer_response_summary}
              </div>
            )}
            {call.recommended_next_step && (
              <div className="text-xs mt-2" style={{ color: "#3D2878" }}>
                <strong>Próximo paso:</strong> {call.recommended_next_step}
              </div>
            )}
          </div>
          <IconChevronRight size={18} className="text-ink-muted shrink-0 mt-1" />
        </div>
      </div>
    </Link>
  );
}

// ============================================================================
// Utils
// ============================================================================

function groupByDay(calls: CallRow[]): Array<{ day: string; calls: CallRow[] }> {
  const map = new Map<string, CallRow[]>();
  for (const c of calls) {
    const day = c.call_timestamp ? c.call_timestamp.slice(0, 10) : "0000-00-00";
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(c);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, calls]) => ({ day, calls }));
}

function formatDayHeader(day: string): string {
  if (day === "0000-00-00") return "Sin fecha";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function responseColor(cat: string | null): string {
  switch (cat) {
    case "interested":
      return "#0F6E56";
    case "callback_requested":
      return "#185FA5";
    case "objection_price":
    case "objection_timing":
    case "objection_no_need":
    case "objection_existing_solution":
    case "objection_authority":
      return "#854F0B";
    case "not_interested":
    case "no_engagement":
    case "wrong_number":
      return "#993C1D";
    case "voicemail":
    case "gatekeeper":
      return "#6B6884";
    default:
      return "#3D2878";
  }
}
