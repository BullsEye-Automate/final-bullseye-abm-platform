"use client";

// Reportería ejecutiva — vista de agencia para mostrarle al cliente.
// Resumen consolidado de prospección + outreach + llamadas + respuestas
// con range selector compartido con /dashboard.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  IconChartBar,
  IconTrendingUp,
  IconTrendingDown,
  IconMinus,
  IconAlertCircle,
  IconRefresh,
  IconChevronDown,
  IconPhoneCall,
  IconMessageDots,
  IconFlame,
  IconBuildingFactory2,
  IconUsers,
  IconRocket,
  IconBrandLinkedin
} from "@tabler/icons-react";
import { RANGE_LABELS, RANGE_ORDER, type RangeKey } from "@/lib/dashboardRanges";

type Delta = { current: number; previous: number; pct_change: number | null };

type Snapshot = {
  range: {
    key: string;
    label: string;
    start: string;
    end: string;
    previous: { start: string; end: string };
  };
  hero: {
    companies_worked: Delta;
    contacts_generated: Delta;
    in_outreach: Delta;
    conversations: Delta;
    hot_leads: Delta;
  };
  executive_funnel: Array<{
    step: string;
    count: number;
    rate_from_prev: number | null;
  }>;
  outreach: {
    leads_in_lemlist: number;
    calls_made: number;
    calls_connected: number;
    avg_duration_sec: number | null;
    avg_sdr_score: number | null;
    pickup_rate_pct: number | null;
  };
  responses: {
    total: number;
    by_category: Array<{ category: string; label: string; count: number }>;
    positive_count: number;
    negative_count: number;
    neutral_count: number;
  };
  hot_leads: Array<{
    contact_id: string;
    contact_name: string;
    company_name: string | null;
    job_title: string | null;
    signals: string[];
    score: number;
    linkedin_url: string | null;
    hubspot_contact_id: string | null;
  }>;
  highlight: string;
  evolution_8mo: Array<{
    month: string;
    label: string;
    companies_clay_push: number;
    contacts_from_clay: number;
    contacts_from_sales_nav: number;
    contacts_total: number;
  }>;
};

export default function ReporteriaPage() {
  const [range, setRange] = useState<RangeKey>("this_month");
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reporteria?range=${range}`, {
        cache: "no-store"
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
      } else {
        setData(j);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="label">Análisis</div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Reportería ejecutiva
          </h1>
          <p className="text-sm text-ink-muted mt-1 max-w-2xl">
            Resumen consolidado de prospección, outreach, llamadas y respuestas.
            Pensado para compartir con el cliente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RangeSelector value={range} onChange={setRange} />
          <button onClick={load} disabled={loading} className="btn-secondary">
            <IconRefresh size={16} /> {loading ? "Cargando…" : "Refrescar"}
          </button>
        </div>
      </header>

      {error && (
        <div className="card bg-danger-bg text-danger-fg flex items-start gap-2 text-sm">
          <IconAlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {data ? (
        <>
          <HighlightBanner text={data.highlight} />
          <HeroKpiGrid hero={data.hero} />
          <ExecutiveFunnel funnel={data.executive_funnel} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <OutreachCard outreach={data.outreach} />
            <CallsCard outreach={data.outreach} />
            <ResponsesCard responses={data.responses} />
          </div>
          <ResponsesDistribution responses={data.responses} />
          <HotLeadsTable leads={data.hot_leads} />
          <EvolutionRecap months={data.evolution_8mo} />
        </>
      ) : !loading && !error ? (
        <div className="card text-center py-12 text-ink-muted">
          Sin datos para este rango.
        </div>
      ) : (
        <div className="card text-ink-muted py-12 text-center">Cargando…</div>
      )}
    </div>
  );
}

// ============================================================================
// Range selector (mismo patrón que /dashboard)
// ============================================================================

function RangeSelector({
  value,
  onChange
}: {
  value: RangeKey;
  onChange: (v: RangeKey) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as RangeKey)}
        className="appearance-none pl-3 pr-8 py-1.5 border border-divider rounded-md text-sm bg-white text-ink"
      >
        {RANGE_ORDER.map((k) => (
          <option key={k} value={k}>
            {RANGE_LABELS[k]}
          </option>
        ))}
      </select>
      <IconChevronDown
        size={14}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"
      />
    </div>
  );
}

// ============================================================================
// Highlight banner — la frase ejecutiva
// ============================================================================

function HighlightBanner({ text }: { text: string }) {
  return (
    <div className="card bg-gradient-to-r from-brand to-brand-soft text-white">
      <div className="flex items-start gap-3">
        <IconFlame size={20} className="shrink-0 mt-0.5" />
        <p className="text-sm leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

// ============================================================================
// Hero KPI grid (5 cards con delta)
// ============================================================================

function HeroKpiGrid({ hero }: { hero: Snapshot["hero"] }) {
  const items: Array<{
    label: string;
    delta: Delta;
    icon: ReactNode;
    hint?: string;
  }> = [
    {
      label: "Empresas prospectadas",
      delta: hero.companies_worked,
      icon: <IconBuildingFactory2 size={18} />
    },
    {
      label: "Contactos generados",
      delta: hero.contacts_generated,
      icon: <IconUsers size={18} />
    },
    {
      label: "En outreach (Lemlist)",
      delta: hero.in_outreach,
      icon: <IconRocket size={18} />
    },
    {
      label: "Conversaciones",
      delta: hero.conversations,
      icon: <IconMessageDots size={18} />,
      hint: "Llamadas + respuestas"
    },
    {
      label: "Hot leads",
      delta: hero.hot_leads,
      icon: <IconFlame size={18} />,
      hint: "Interesados, callbacks, positivos"
    }
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {items.map((it) =>
        it.hint ? (
          <KpiCard
            key={it.label}
            label={it.label}
            delta={it.delta}
            icon={it.icon}
            hint={it.hint}
          />
        ) : (
          <KpiCard
            key={it.label}
            label={it.label}
            delta={it.delta}
            icon={it.icon}
          />
        )
      )}
    </div>
  );
}

function KpiCard({
  label,
  delta,
  icon,
  hint
}: {
  label: string;
  delta: Delta;
  icon: ReactNode;
  hint?: string;
}) {
  const sign =
    delta.pct_change == null ? 0 : delta.pct_change > 0 ? 1 : delta.pct_change < 0 ? -1 : 0;
  const Arrow =
    sign > 0 ? IconTrendingUp : sign < 0 ? IconTrendingDown : IconMinus;
  const sColor =
    sign > 0
      ? "text-success-fg"
      : sign < 0
      ? "text-danger-fg"
      : "text-ink-muted";
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2 text-brand">
        {icon}
      </div>
      <div className="text-2xl font-semibold text-ink tabular-nums">
        {delta.current.toLocaleString("es")}
      </div>
      <div className="text-xs text-ink-muted">{label}</div>
      {hint && <div className="text-[10px] text-ink-subtle leading-tight">{hint}</div>}
      <div className={`mt-2 inline-flex items-center gap-1 text-xs ${sColor}`}>
        <Arrow size={12} />
        {delta.pct_change == null
          ? "—"
          : `${delta.pct_change > 0 ? "+" : ""}${delta.pct_change.toFixed(0)}%`}
        <span className="text-ink-subtle">
          vs {delta.previous.toLocaleString("es")}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// Executive funnel
// ============================================================================

function ExecutiveFunnel({ funnel }: { funnel: Snapshot["executive_funnel"] }) {
  const top = funnel[0]?.count || 1;
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconChartBar size={16} />
        <h2 className="text-sm font-semibold text-ink">Embudo ejecutivo</h2>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Conversión etapa a etapa del período seleccionado.
      </p>
      <div className="space-y-2">
        {funnel.map((s, i) => (
          <div key={s.step} className="flex items-center gap-3">
            <div className="w-56 shrink-0 text-sm text-ink">{s.step}</div>
            <div className="flex-1 relative h-7 bg-[#F1EEF7] rounded overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-brand"
                style={{ width: `${(s.count / top) * 100}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-end px-2 text-xs font-medium text-ink tabular-nums">
                {s.count.toLocaleString("es")}
              </div>
            </div>
            <div className="w-24 text-xs text-ink-muted text-right shrink-0 tabular-nums">
              {i === 0
                ? "—"
                : s.rate_from_prev == null
                ? "—"
                : `${s.rate_from_prev.toFixed(0)}%`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Outreach / Calls / Responses cards
// ============================================================================

function OutreachCard({ outreach }: { outreach: Snapshot["outreach"] }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconRocket size={16} />
        <h3 className="text-sm font-semibold text-ink">Outreach activo</h3>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Leads que están recibiendo mensajes en Lemlist en el período.
      </p>
      <div className="space-y-3">
        <Stat label="Leads en Lemlist" value={outreach.leads_in_lemlist} />
      </div>
    </div>
  );
}

function CallsCard({ outreach }: { outreach: Snapshot["outreach"] }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconPhoneCall size={16} />
        <h3 className="text-sm font-semibold text-ink">Llamadas</h3>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Actividad telefónica del equipo en el período.
      </p>
      <div className="space-y-3">
        <Stat label="Llamadas hechas" value={outreach.calls_made} />
        <Stat
          label="Conectadas"
          value={outreach.calls_connected}
          sub={
            outreach.pickup_rate_pct == null
              ? undefined
              : `Pickup ${outreach.pickup_rate_pct.toFixed(0)}%`
          }
        />
        <Stat
          label="Duración promedio"
          value={
            outreach.avg_duration_sec == null
              ? "—"
              : `${Math.round(outreach.avg_duration_sec / 60)}m ${Math.round(
                  outreach.avg_duration_sec % 60
                )}s`
          }
        />
        <Stat
          label="Score SDR promedio"
          value={
            outreach.avg_sdr_score == null
              ? "—"
              : `${outreach.avg_sdr_score.toFixed(1)} / 10`
          }
        />
      </div>
    </div>
  );
}

function ResponsesCard({ responses }: { responses: Snapshot["responses"] }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconMessageDots size={16} />
        <h3 className="text-sm font-semibold text-ink">Respuestas</h3>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Replies a la campaña de Lemlist en el período.
      </p>
      <div className="space-y-3">
        <Stat label="Total respuestas" value={responses.total} />
        <Stat
          label="Positivas"
          value={responses.positive_count}
          sub={
            responses.total > 0
              ? `${Math.round(
                  (responses.positive_count / responses.total) * 100
                )}% del total`
              : undefined
          }
          highlight="success"
        />
        <Stat
          label="Negativas"
          value={responses.negative_count}
          sub={
            responses.total > 0
              ? `${Math.round(
                  (responses.negative_count / responses.total) * 100
                )}% del total`
              : undefined
          }
          highlight="danger"
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight
}: {
  label: string;
  value: number | string;
  sub?: string;
  highlight?: "success" | "danger";
}) {
  const cls =
    highlight === "success"
      ? "text-success-fg"
      : highlight === "danger"
      ? "text-danger-fg"
      : "text-ink";
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${cls}`}>
        {typeof value === "number" ? value.toLocaleString("es") : value}
      </div>
      {sub && <div className="text-[10px] text-ink-subtle leading-tight">{sub}</div>}
    </div>
  );
}

// ============================================================================
// Responses distribution (horizontal bars por categoría)
// ============================================================================

function ResponsesDistribution({
  responses
}: {
  responses: Snapshot["responses"];
}) {
  if (responses.by_category.length === 0) return null;
  const max = Math.max(1, ...responses.by_category.map((c) => c.count));
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconChartBar size={16} />
        <h3 className="text-sm font-semibold text-ink">
          Distribución de respuestas
        </h3>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Categorización IA de cada respuesta recibida.
      </p>
      <div className="space-y-1.5">
        {responses.by_category.map((c) => (
          <div key={c.category} className="flex items-center gap-3">
            <div className="w-44 shrink-0 text-sm text-ink">{c.label}</div>
            <div className="flex-1 relative h-6 bg-[#F1EEF7] rounded overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-brand-soft"
                style={{ width: `${(c.count / max) * 100}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-end px-2 text-xs font-medium text-ink tabular-nums">
                {c.count}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Hot leads table — top 10 contactos rankeados por señales
// ============================================================================

function HotLeadsTable({ leads }: { leads: Snapshot["hot_leads"] }) {
  if (leads.length === 0) {
    return (
      <div className="card text-ink-muted text-sm">
        <div className="flex items-center gap-2 text-brand mb-1">
          <IconFlame size={16} />
          <h3 className="text-sm font-semibold text-ink">
            Hot leads para seguimiento
          </h3>
        </div>
        Sin hot leads identificados en el período.
      </div>
    );
  }
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconFlame size={16} />
        <h3 className="text-sm font-semibold text-ink">
          Hot leads para seguimiento
        </h3>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Top contactos rankeados por señales recientes (calls interesadas,
        callbacks, respuestas positivas, fit alto).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-ink-muted border-b border-[#EEEDFE]">
              <th className="text-left py-2 pr-4 font-medium">Contacto</th>
              <th className="text-left py-2 pr-4 font-medium">Empresa</th>
              <th className="text-left py-2 pr-4 font-medium">Cargo</th>
              <th className="text-left py-2 pr-4 font-medium">Señales</th>
              <th className="text-right py-2 pr-4 font-medium">Score</th>
              <th className="text-right py-2 font-medium">Links</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr
                key={l.contact_id}
                className="border-b border-[#F4F2FB] last:border-0"
              >
                <td className="py-2 pr-4 font-medium text-ink">
                  {l.contact_name}
                </td>
                <td className="py-2 pr-4 text-ink-muted">
                  {l.company_name ?? "—"}
                </td>
                <td className="py-2 pr-4 text-ink-muted text-xs">
                  {l.job_title ?? "—"}
                </td>
                <td className="py-2 pr-4">
                  <div className="flex flex-wrap gap-1">
                    {l.signals.map((s, i) => (
                      <span
                        key={i}
                        className="badge bg-warning-bg text-warning-fg text-[10px]"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-2 pr-4 text-right tabular-nums font-medium text-ink">
                  {l.score}
                </td>
                <td className="py-2 text-right">
                  {l.linkedin_url && (
                    <a
                      href={l.linkedin_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand hover:underline inline-flex items-center"
                      title="Abrir en LinkedIn"
                    >
                      <IconBrandLinkedin size={14} />
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Evolution recap — 8 meses
// ============================================================================

function EvolutionRecap({ months }: { months: Snapshot["evolution_8mo"] }) {
  const maxCompanies = Math.max(1, ...months.map((m) => m.companies_clay_push));
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconChartBar size={16} />
        <h3 className="text-sm font-semibold text-ink">
          Evolución mensual · últimos 8 meses
        </h3>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Empresas que entraron al sistema (push a Clay) por mes.
      </p>
      <div className="grid grid-cols-8 gap-2">
        {months.map((m) => {
          const pct = (m.companies_clay_push / maxCompanies) * 100;
          return (
            <div key={m.month} className="flex flex-col items-center gap-1.5">
              <div className="w-full h-24 flex items-end">
                <div
                  className="w-full bg-brand rounded-t"
                  style={{ height: `${pct}%` }}
                />
              </div>
              <div className="text-[10px] text-ink-muted text-center leading-tight">
                <div className="font-medium tabular-nums">
                  {m.companies_clay_push}
                </div>
                <div>{m.label}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
