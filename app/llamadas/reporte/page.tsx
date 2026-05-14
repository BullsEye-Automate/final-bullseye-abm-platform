"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  IconArrowLeft,
  IconRefresh,
  IconAlertCircle,
  IconReportAnalytics,
  IconTrophy,
  IconBulb,
  IconStarFilled,
  IconChevronDown,
  IconChevronRight,
  IconFlame,
  IconExternalLink,
  IconBuildingFactory2,
  IconPhone,
  IconQuote,
  IconUser
} from "@tabler/icons-react";
import { RANGE_LABELS, RANGE_ORDER, type RangeKey } from "@/lib/dashboardRanges";

type Report = {
  range: { key: string; label: string; start: string; end: string };
  totals: {
    calls: number;
    analyzed: number;
    unique_contacts: number;
    unique_companies: number;
    avg_score: number | null;
    pickup_rate_calls: number | null;
    pickup_calls_numerator: number;
    pickup_calls_denominator: number;
    pickup_rate_contacts: number | null;
    pickup_contacts_numerator: number;
    pickup_contacts_denominator: number;
  };
  sub_scores: {
    opening: number | null;
    discovery: number | null;
    objection_handling: number | null;
    next_step: number | null;
  };
  response_distribution: Array<{ key: string; label: string; count: number; call_ids: string[] }>;
  sdr_ranking: Array<{
    hubspot_owner_id: string;
    name: string;
    calls: number;
    analyzed: number;
    avg_score: number | null;
    interested: number;
    interested_rate: number | null;
  }>;
  top_improvement_areas: Array<{
    area: string;
    count: number;
    call_ids: string[];
    top_suggestions: Array<{ text: string; count: number }>;
    example_quotes: Array<{ call_id: string; quote: string }>;
  }>;
  activity: Array<{ date: string; calls: number; avg_score: number | null }>;
};

type Owner = { hubspot_owner_id: string; name: string; calls: number };

type CallSlim = {
  id: string;
  call_timestamp: string | null;
  direction: string | null;
  duration_ms: number | null;
  owner_name: string | null;
  customer_response_label: string | null;
  customer_response_summary: string | null;
  sdr_score_overall: number | null;
  recommended_next_step: string | null;
  has_transcription: boolean;
  contact: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    company: { id: string; company_name: string } | null;
  } | null;
  company: { id: string; company_name: string } | null;
};

type HotLead = {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  fit_score: number | null;
  fit_action: string | null;
  lemlist_pushed: boolean;
  hubspot_pushed: boolean;
  company: {
    id: string;
    company_name: string;
    company_size: number | null;
    company_type: string | null;
  } | null;
  last_call: {
    id: string;
    timestamp: string | null;
    category: string | null;
    summary: string | null;
    next_step: string | null;
    owner_name: string | null;
  };
  score: number;
};

export default function ReporteLlamadasPage() {
  const [range, setRange] = useState<RangeKey>("this_month");
  const [owner, setOwner] = useState<string>("");
  const [owners, setOwners] = useState<Owner[]>([]);
  const [data, setData] = useState<Report | null>(null);
  const [hotLeads, setHotLeads] = useState<HotLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (k: RangeKey, o: string) => {
    setLoading(true);
    setError(null);
    try {
      const reportParams = new URLSearchParams({ range: k });
      if (o) reportParams.set("owner", o);
      const hotParams = new URLSearchParams({ range: k });
      if (o) hotParams.set("owner", o);
      const [reportRes, hotRes] = await Promise.all([
        fetch(`/api/calls/report?${reportParams.toString()}`),
        fetch(`/api/calls/hot-leads?${hotParams.toString()}`)
      ]);
      const json = await reportRes.json();
      if (!reportRes.ok) {
        setError(json.error ?? `HTTP ${reportRes.status}`);
        setData(null);
      } else {
        setData(json);
      }
      const hot = await hotRes.json();
      if (hotRes.ok) setHotLeads(hot.leads ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range, owner);
  }, [range, owner, load]);

  useEffect(() => {
    fetch("/api/calls/owners")
      .then((r) => r.json())
      .then((j) => setOwners(j.owners ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href="/llamadas" className="btn-secondary text-sm">
          <IconArrowLeft size={14} /> Volver a llamadas
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="bg-white border border-[#E5E2F0] rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos los SDRs</option>
            {owners.map((o) => (
              <option key={o.hubspot_owner_id} value={o.hubspot_owner_id}>
                {o.name} ({o.calls})
              </option>
            ))}
          </select>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as RangeKey)}
            className="bg-white border border-[#E5E2F0] rounded-lg px-3 py-2 text-sm"
          >
            {RANGE_ORDER.map((k) => (
              <option key={k} value={k}>
                {RANGE_LABELS[k]}
              </option>
            ))}
          </select>
          <button onClick={() => load(range, owner)} disabled={loading} className="btn-secondary text-sm">
            <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <header>
        <div className="label">Análisis · Llamadas</div>
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
          <IconReportAnalytics size={26} /> Reporte de llamadas
        </h1>
        <div className="text-sm text-ink-muted mt-1">
          Cómo respondieron los clientes, qué tan bien lo hicieron los SDRs y dónde mejorar.
        </div>
      </header>

      {error && (
        <div className="card border-l-4 border-danger-fg">
          <div className="flex items-center gap-2 text-danger-fg">
            <IconAlertCircle size={16} /> {error}
          </div>
        </div>
      )}

      {!data && !error && (
        <div className="card text-center py-12 text-ink-muted">
          {loading ? "Cargando…" : "Sin datos para este rango."}
        </div>
      )}

      {data && (
        <>
          <Totals data={data} />
          <HotLeadsCard leads={hotLeads} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ResponseDistributionCard items={data.response_distribution} />
            <SubScoresCard scores={data.sub_scores} />
          </div>
          <SdrRankingCard ranking={data.sdr_ranking} />
          <ImprovementsCard areas={data.top_improvement_areas} />
          <ActivityCard activity={data.activity} />
        </>
      )}
    </div>
  );
}

// ============================================================================

function Totals({ data }: { data: Report }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <div className="card">
        <div className="label">Total llamadas</div>
        <div className="text-2xl font-semibold tracking-tight mt-1">{data.totals.calls}</div>
        <div className="text-xs text-ink-muted mt-1">
          {data.totals.analyzed} analizadas
        </div>
      </div>
      <div className="card">
        <div className="label">Contactos llamados</div>
        <div className="text-2xl font-semibold tracking-tight mt-1">{data.totals.unique_contacts}</div>
        <div className="text-xs text-ink-muted mt-1">únicos</div>
      </div>
      <div className="card">
        <div className="label">Empresas alcanzadas</div>
        <div className="text-2xl font-semibold tracking-tight mt-1">{data.totals.unique_companies}</div>
        <div className="text-xs text-ink-muted mt-1">únicas</div>
      </div>
      <div className="card">
        <div className="label">Tasa pickup · llamada</div>
        <div
          className="text-2xl font-semibold tracking-tight mt-1"
          style={{
            color:
              data.totals.pickup_rate_calls == null
                ? "#1A1733"
                : data.totals.pickup_rate_calls >= 40
                ? "#0F6E56"
                : data.totals.pickup_rate_calls < 20
                ? "#993C1D"
                : "#854F0B"
          }}
        >
          {data.totals.pickup_rate_calls == null ? "—" : `${data.totals.pickup_rate_calls}%`}
        </div>
        <div className="text-xs text-ink-muted mt-1">
          {data.totals.pickup_calls_numerator}/{data.totals.pickup_calls_denominator} contestadas
        </div>
      </div>
      <div className="card">
        <div className="label">Tasa pickup · contacto</div>
        <div
          className="text-2xl font-semibold tracking-tight mt-1"
          style={{
            color:
              data.totals.pickup_rate_contacts == null
                ? "#1A1733"
                : data.totals.pickup_rate_contacts >= 50
                ? "#0F6E56"
                : data.totals.pickup_rate_contacts < 30
                ? "#993C1D"
                : "#854F0B"
          }}
        >
          {data.totals.pickup_rate_contacts == null ? "—" : `${data.totals.pickup_rate_contacts}%`}
        </div>
        <div className="text-xs text-ink-muted mt-1">
          {data.totals.pickup_contacts_numerator}/{data.totals.pickup_contacts_denominator} atendieron
        </div>
      </div>
      <div className="card">
        <div className="label">Score SDR promedio</div>
        <div
          className="text-2xl font-semibold tracking-tight mt-1"
          style={{
            color:
              data.totals.avg_score == null
                ? "#1A1733"
                : data.totals.avg_score >= 7
                ? "#0F6E56"
                : data.totals.avg_score < 5
                ? "#993C1D"
                : "#854F0B"
          }}
        >
          {data.totals.avg_score == null ? "—" : `${data.totals.avg_score}/10`}
        </div>
        <div className="text-xs text-ink-muted mt-1">según IA</div>
      </div>
    </div>
  );
}

function HotLeadsCard({ leads }: { leads: HotLead[] }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <IconFlame size={16} style={{ color: "#993C1D" }} />
        <div className="label" style={{ color: "#993C1D" }}>Mayor probabilidad de conversión este período</div>
      </div>
      {leads.length === 0 ? (
        <div className="text-sm text-ink-muted">
          Todavía no hay contactos con señales positivas en sus últimas llamadas.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-[#E5E2F0]">
                <th className="py-2 pr-3">Contacto</th>
                <th className="py-2 pr-3">Empresa</th>
                <th className="py-2 pr-3">Última señal</th>
                <th className="py-2 pr-3">Próximo paso sugerido</th>
                <th className="py-2 pr-3 text-right">Fit</th>
                <th className="py-2 text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l, i) => (
                <tr key={l.contact_id} className="border-b border-[#F4F2FB] last:border-b-0 align-top">
                  <td className="py-3 pr-3">
                    <div className="font-medium">{l.full_name ?? "(sin nombre)"}</div>
                    <div className="text-xs text-ink-muted">{l.job_title ?? "—"}</div>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {l.phone && (
                        <span className="chip text-[10px] bg-canvas">
                          <IconPhone size={9} className="inline" /> phone
                        </span>
                      )}
                      {l.lemlist_pushed && (
                        <span className="chip text-[10px] bg-[#EEEDFE] text-[#3D2878]">Lemlist</span>
                      )}
                      {l.hubspot_pushed && (
                        <span className="chip text-[10px] bg-[#EEEDFE] text-[#3D2878]">HubSpot</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="text-sm">{l.company?.company_name ?? "—"}</div>
                    {l.company?.company_size != null && (
                      <div className="text-xs text-ink-muted">{l.company.company_size} empl.</div>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <span
                      className="chip text-[10px] text-white"
                      style={{ background: responseColor(l.last_call.category) }}
                    >
                      {l.last_call.category}
                    </span>
                    {l.last_call.summary && (
                      <div className="text-xs text-ink-muted mt-1 line-clamp-2">{l.last_call.summary}</div>
                    )}
                    {l.last_call.timestamp && (
                      <div className="text-[10px] text-ink-muted mt-1">
                        {formatRelative(l.last_call.timestamp)} · {l.last_call.owner_name ?? "—"}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-xs max-w-[280px]">
                    {l.last_call.next_step ?? <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="py-3 pr-3 text-right">
                    {l.fit_score == null ? "—" : `${l.fit_score}/10`}
                  </td>
                  <td className="py-3 text-right">
                    <span
                      className="font-semibold"
                      style={{
                        color: l.score >= 80 ? "#0F6E56" : l.score >= 50 ? "#854F0B" : "#6B6884"
                      }}
                    >
                      {l.score}
                    </span>
                    <div className="mt-1">
                      <Link
                        href={`/llamadas/${l.last_call.id}`}
                        className="text-[10px] text-[#3D2878] inline-flex items-center gap-0.5"
                      >
                        ver call <IconExternalLink size={9} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResponseDistributionCard({
  items
}: {
  items: Report["response_distribution"];
}) {
  const total = items.reduce((s, i) => s + i.count, 0);
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="card">
      <div className="label mb-3">Respuestas del cliente</div>
      {total === 0 && <div className="text-sm text-ink-muted">Sin datos.</div>}
      <div className="space-y-2">
        {items.map((it) => {
          const pct = total > 0 ? (it.count / total) * 100 : 0;
          const isOpen = expanded === it.key;
          return (
            <div key={it.key}>
              <button
                onClick={() => setExpanded(isOpen ? null : it.key)}
                className="w-full text-left hover:bg-canvas rounded px-1 py-0.5"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink flex items-center gap-1">
                    {isOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                    {it.label}
                  </span>
                  <span className="text-ink-muted">
                    {it.count} <span className="text-[10px]">· {pct.toFixed(0)}%</span>
                  </span>
                </div>
                <div className="h-2 mt-1 bg-canvas rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: responseColor(it.key) }}
                  />
                </div>
              </button>
              {isOpen && it.call_ids.length > 0 && (
                <DrilldownCallList ids={it.call_ids} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DrilldownCallList({ ids }: { ids: string[] }) {
  const [calls, setCalls] = useState<CallSlim[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/calls/by-ids", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setCalls(j.calls ?? []);
      })
      .catch(() => {
        if (!cancelled) setCalls([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ids]);
  if (loading) return <div className="text-xs text-ink-muted px-2 py-2">Cargando…</div>;
  if (!calls || calls.length === 0) {
    return <div className="text-xs text-ink-muted px-2 py-2">Sin llamadas.</div>;
  }
  return (
    <div className="mt-2 ml-4 space-y-1 border-l border-[#E5E2F0] pl-3">
      {calls.map((c) => {
        const name =
          c.contact && [c.contact.first_name, c.contact.last_name].filter(Boolean).join(" ");
        const company = c.company?.company_name ?? c.contact?.company?.company_name;
        return (
          <Link
            key={c.id}
            href={`/llamadas/${c.id}`}
            className="block text-xs hover:bg-canvas rounded px-2 py-1.5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex-1 min-w-0">
                <span className="font-medium">{name ?? "(sin contacto)"}</span>
                {company && <span className="text-ink-muted"> · {company}</span>}
                {c.owner_name && <span className="text-ink-muted"> · {c.owner_name}</span>}
              </div>
              {c.sdr_score_overall != null && (
                <span
                  className="text-[10px] font-semibold"
                  style={{
                    color:
                      c.sdr_score_overall >= 7
                        ? "#0F6E56"
                        : c.sdr_score_overall < 5
                        ? "#993C1D"
                        : "#854F0B"
                  }}
                >
                  {c.sdr_score_overall.toFixed(1)}/10
                </span>
              )}
            </div>
            {c.customer_response_summary && (
              <div className="text-ink-muted line-clamp-2 mt-0.5">{c.customer_response_summary}</div>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function SubScoresCard({
  scores
}: {
  scores: Report["sub_scores"];
}) {
  const items: Array<{ label: string; value: number | null }> = [
    { label: "Apertura", value: scores.opening },
    { label: "Descubrimiento", value: scores.discovery },
    { label: "Manejo de objeciones", value: scores.objection_handling },
    { label: "Próximo paso", value: scores.next_step }
  ];
  return (
    <div className="card">
      <div className="label mb-3 flex items-center gap-1">
        <IconStarFilled size={11} /> Sub-scores promedio
      </div>
      <div className="space-y-3">
        {items.map((it) => {
          const v = it.value ?? 0;
          const pct = Math.min(100, (v / 10) * 100);
          const color = v >= 7 ? "#0F6E56" : v < 5 ? "#993C1D" : "#854F0B";
          return (
            <div key={it.label}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink">{it.label}</span>
                <span className="font-semibold" style={{ color }}>
                  {it.value == null ? "—" : `${v.toFixed(1)}/10`}
                </span>
              </div>
              <div className="h-2 mt-1 bg-canvas rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SdrRankingCard({
  ranking
}: {
  ranking: Report["sdr_ranking"];
}) {
  return (
    <div className="card">
      <div className="label mb-3 flex items-center gap-1">
        <IconTrophy size={11} /> Ranking SDRs
      </div>
      {ranking.length === 0 ? (
        <div className="text-sm text-ink-muted">Sin SDRs con llamadas en el período.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-[#E5E2F0]">
                <th className="py-2 pr-3">SDR</th>
                <th className="py-2 pr-3 text-right">Llamadas</th>
                <th className="py-2 pr-3 text-right">Score</th>
                <th className="py-2 pr-3 text-right">Interesados</th>
                <th className="py-2 text-right">% interés</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r, i) => (
                <tr key={r.hubspot_owner_id} className="border-b border-[#F4F2FB] last:border-b-0">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{r.name}</span>
                    {i === 0 && ranking.length > 1 && (
                      <span className="ml-2 text-[10px] chip bg-[#FFF7E6] text-[#854F0B]">top</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {r.calls} <span className="text-ink-muted text-xs">({r.analyzed})</span>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {r.avg_score == null ? (
                      <span className="text-ink-muted">—</span>
                    ) : (
                      <span
                        className="font-semibold"
                        style={{
                          color:
                            r.avg_score >= 7
                              ? "#0F6E56"
                              : r.avg_score < 5
                              ? "#993C1D"
                              : "#854F0B"
                        }}
                      >
                        {r.avg_score.toFixed(1)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">{r.interested}</td>
                  <td className="py-2 text-right">
                    {r.interested_rate == null ? "—" : `${r.interested_rate}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ImprovementsCard({
  areas
}: {
  areas: Report["top_improvement_areas"];
}) {
  const max = areas[0]?.count ?? 1;
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="card">
      <div className="label mb-3 flex items-center gap-1">
        <IconBulb size={11} /> Top oportunidades de mejora detectadas
      </div>
      {areas.length === 0 ? (
        <div className="text-sm text-ink-muted">No hay análisis con mejoras aún.</div>
      ) : (
        <div className="space-y-2">
          {areas.map((a) => {
            const pct = (a.count / max) * 100;
            const isOpen = expanded === a.area;
            return (
              <div key={a.area}>
                <button
                  onClick={() => setExpanded(isOpen ? null : a.area)}
                  className="w-full text-left hover:bg-canvas rounded px-1 py-0.5"
                >
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-1">
                      {isOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                      {a.area}
                    </span>
                    <span className="text-ink-muted">{a.count}× · {a.call_ids.length} llamadas</span>
                  </div>
                  <div className="h-2 mt-1 bg-canvas rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#854F0B" }} />
                  </div>
                </button>
                {isOpen && (
                  <div className="mt-2 ml-4 pl-3 border-l border-[#E5E2F0] space-y-3">
                    {a.top_suggestions.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-ink mb-1">Sugerencias recurrentes</div>
                        <ul className="space-y-1">
                          {a.top_suggestions.map((s, i) => (
                            <li key={i} className="text-xs text-ink flex items-start gap-2">
                              <span style={{ color: "#854F0B" }}>•</span>
                              <span>
                                {s.text}{" "}
                                {s.count > 1 && (
                                  <span className="text-ink-muted">({s.count}×)</span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {a.example_quotes.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-ink mb-1">Citas representativas</div>
                        <div className="space-y-1.5">
                          {a.example_quotes.map((q, i) => (
                            <Link
                              key={i}
                              href={`/llamadas/${q.call_id}`}
                              className="block text-xs text-ink-muted hover:bg-canvas rounded px-2 py-1"
                            >
                              <IconQuote size={10} className="inline mr-1" />
                              <em>{q.quote}</em>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-semibold text-ink mb-1">Llamadas que aparecen acá</div>
                      <DrilldownCallList ids={a.call_ids} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActivityCard({ activity }: { activity: Report["activity"] }) {
  if (activity.length === 0) return null;
  const max = Math.max(...activity.map((a) => a.calls), 1);
  return (
    <div className="card">
      <div className="label mb-3">Actividad diaria</div>
      <div className="flex items-end gap-1 h-32">
        {activity.map((a) => {
          const h = (a.calls / max) * 100;
          const color = a.avg_score == null ? "#7F77DD" : a.avg_score >= 7 ? "#0F6E56" : a.avg_score < 5 ? "#993C1D" : "#854F0B";
          return (
            <div key={a.date} className="flex-1 flex flex-col items-center group relative">
              <div
                className="w-full rounded-t"
                style={{ height: `${Math.max(h, 4)}%`, background: color, minHeight: 4 }}
              />
              <div className="absolute -top-10 hidden group-hover:block bg-white border border-[#E5E2F0] shadow-card rounded-md px-2 py-1 text-[10px] whitespace-nowrap z-10">
                {a.date} · {a.calls} llamadas{a.avg_score != null && ` · score ${a.avg_score}`}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-ink-muted mt-2">
        <span>{activity[0]?.date}</span>
        <span>{activity[activity.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "hace instantes";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.round(h / 24);
  return `hace ${d}d`;
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
