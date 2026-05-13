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
  IconUser
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
  avg_duration_sec: number;
  avg_sdr_score: number | null;
  interested_count: number;
  callbacks_count: number;
  interested_rate: number | null;
};

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
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ range });
    if (response) params.set("response", response);
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
  }, [range, response]);

  useEffect(() => {
    load();
  }, [load]);

  async function runSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/calls/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since_days: 30, analyze: true })
      });
      const json = await res.json();
      if (!res.ok) {
        setSyncMsg(`Error sync: ${json.error ?? json.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
      } else {
        setSyncMsg(
          `OK · ${json.scanned} escaneadas · ${json.upserted} guardadas · ${json.analyzed} analizadas` +
            (json.failed_analysis > 0 ? ` · ${json.failed_analysis} fallaron análisis` : "")
        );
        load();
      }
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : "Network error");
    } finally {
      setSyncing(false);
    }
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
      />

      {syncMsg && (
        <div className="card text-sm" style={{ borderLeft: "4px solid #185FA5" }}>
          {syncMsg}
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

      <Filters response={response} onResponseChange={setResponse} />

      {!loading && data && data.calls.length === 0 && (
        <div className="card text-center py-12 text-ink-muted">
          No hay llamadas en este rango. Probá <strong>“Sincronizar HubSpot”</strong> arriba.
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
  syncing
}: {
  range: RangeKey | "all";
  onRangeChange: (k: RangeKey | "all") => void;
  onRefresh: () => void;
  loading: boolean;
  onSync: () => void;
  syncing: boolean;
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
        <button onClick={onSync} disabled={syncing} className="btn-primary text-sm">
          <IconCloudDownload size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Sincronizando…" : "Sincronizar HubSpot"}
        </button>
      </div>
    </header>
  );
}

function KpiCards({ kpis }: { kpis: Kpis }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Kpi label="Llamadas" value={String(kpis.total_calls)} sub={`${kpis.total_analyzed} analizadas`} />
      <Kpi
        label="Duración promedio"
        value={formatDuration(kpis.avg_duration_sec)}
        sub="por llamada"
      />
      <Kpi
        label="Score SDR promedio"
        value={kpis.avg_sdr_score == null ? "—" : `${kpis.avg_sdr_score}/10`}
        sub={kpis.total_analyzed > 0 ? "según IA" : "sin análisis"}
        accent={kpis.avg_sdr_score != null && kpis.avg_sdr_score >= 7 ? "good" : kpis.avg_sdr_score != null && kpis.avg_sdr_score < 5 ? "bad" : undefined}
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
  onResponseChange
}: {
  response: string;
  onResponseChange: (v: string) => void;
}) {
  return (
    <div className="card flex flex-wrap items-center gap-3">
      <div className="text-sm text-ink-muted">Filtrar por respuesta del cliente:</div>
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
