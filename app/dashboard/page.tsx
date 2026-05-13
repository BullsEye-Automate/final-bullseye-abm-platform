"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconBuildingFactory2,
  IconUsers,
  IconPhone,
  IconCloudUpload,
  IconTrendingUp,
  IconTrendingDown,
  IconMinus,
  IconChartBar,
  IconCalendarStats,
  IconAlertCircle,
  IconRefresh,
  IconChevronDown,
  IconTargetArrow,
  IconCheck,
  IconCircleDot,
  IconClipboardList
} from "@tabler/icons-react";
import { RANGE_LABELS, RANGE_ORDER, type RangeKey } from "@/lib/dashboardRanges";

// ---- Types (deben matchear el endpoint /api/dashboard) ----
type Delta = { current: number; previous: number; pct_change: number | null };

type Dashboard = {
  range: { key: string; label: string; start: string; end: string; previous: { start: string; end: string } };
  pipeline: {
    companies_discovered: Delta;
    companies_approved: Delta;
    companies_rejected: Delta;
    contacts_imported: Delta;
    contacts_yes: Delta;
    contacts_in_lemlist: Delta;
    contacts_with_phone: Delta;
    contacts_in_hubspot: Delta;
    approval_rate: number | null;
    fit_rate: number | null;
    phone_rate: number | null;
    hubspot_rate: number | null;
  };
  funnel: Array<{ step: string; count: number; rate_from_prev: number | null; rate_from_top: number | null }>;
  distribution: {
    company_types: Array<{ key: string; label: string; count: number }>;
    phone_sources: Array<{ key: string; label: string; count: number }>;
    fit_actions: Array<{ key: string; label: string; count: number }>;
  };
  quality: {
    manual_review_pending: number;
    human_agreement_rate: number | null;
    discard_reasons: Array<{ reason: string; count: number }>;
  };
  activity: Array<{ date: string; companies_approved: number; contacts_imported: number }>;
};

export default function DashboardPage() {
  const [range, setRange] = useState<RangeKey>("this_month");
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (key: RangeKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard?range=${key}`);
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
  }, []);

  useEffect(() => {
    load(range);
  }, [range, load]);

  return (
    <div className="space-y-6">
      <Header
        range={range}
        onRangeChange={setRange}
        loading={loading}
        onRefresh={() => load(range)}
        rangeLabel={data?.range.label ?? RANGE_LABELS[range]}
        rangeWindow={data ? formatRangeWindow(data.range.start, data.range.end) : null}
      />

      {error && (
        <div className="card border-l-4 border-danger-fg">
          <div className="flex items-center gap-2 text-danger-fg font-medium">
            <IconAlertCircle size={16} /> {error}
          </div>
        </div>
      )}

      {data ? (
        <>
          <HeroKpis pipeline={data.pipeline} />
          <ConversionRates pipeline={data.pipeline} />
          <FunnelCard funnel={data.funnel} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DistributionCard
              title="Empresas por tipo"
              subtitle="Mix de empresas descubiertas en el período"
              icon={<IconBuildingFactory2 size={16} />}
              items={data.distribution.company_types}
              palette={COMPANY_PALETTE}
            />
            <DistributionCard
              title="Origen de teléfonos"
              subtitle="Solo contactos pusheados a Lemlist (outreach activo)"
              icon={<IconPhone size={16} />}
              items={data.distribution.phone_sources}
              palette={PHONE_PALETTE}
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <FitActionsCard items={data.distribution.fit_actions} />
            <QualityCard quality={data.quality} />
            <DiscardReasonsCard reasons={data.quality.discard_reasons} />
          </div>
          <ActivityCard activity={data.activity} />
        </>
      ) : !loading && !error ? (
        <div className="card text-center py-12 text-ink-muted">
          Sin datos para este rango.
        </div>
      ) : (
        <LoadingState />
      )}
    </div>
  );
}

// ============================================================================
// Header
// ============================================================================

function Header({
  range,
  onRangeChange,
  loading,
  onRefresh,
  rangeLabel,
  rangeWindow
}: {
  range: RangeKey;
  onRangeChange: (k: RangeKey) => void;
  loading: boolean;
  onRefresh: () => void;
  rangeLabel: string;
  rangeWindow: string | null;
}) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div>
        <div className="label">Prospección · Resumen ejecutivo</div>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <div className="text-sm text-ink-muted mt-1">
          {rangeLabel}
          {rangeWindow && <span className="text-ink-subtle"> · {rangeWindow}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <RangeSelector value={range} onChange={onRangeChange} />
        <button onClick={onRefresh} disabled={loading} className="btn-secondary text-sm" title="Refrescar">
          <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
          {loading ? "Cargando…" : "Refrescar"}
        </button>
      </div>
    </header>
  );
}

function RangeSelector({
  value,
  onChange
}: {
  value: RangeKey;
  onChange: (k: RangeKey) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as RangeKey)}
        className="appearance-none bg-white border border-[#E5E2F0] rounded-lg pl-3 pr-9 py-2 text-sm font-medium text-ink hover:border-brand-soft focus:outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand-tint cursor-pointer"
      >
        {RANGE_ORDER.map((k) => (
          <option key={k} value={k}>
            {RANGE_LABELS[k]}
          </option>
        ))}
      </select>
      <IconChevronDown
        size={14}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"
      />
    </div>
  );
}

// ============================================================================
// Hero KPIs (4 grandes)
// ============================================================================

function HeroKpis({ pipeline }: { pipeline: Dashboard["pipeline"] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard
        icon={<IconBuildingFactory2 size={18} />}
        accent="brand"
        title="Empresas aprobadas"
        delta={pipeline.companies_approved}
        sub={`de ${pipeline.companies_discovered.current} descubiertas`}
      />
      <KpiCard
        icon={<IconUsers size={18} />}
        accent="info"
        title="Contactos en Lemlist"
        delta={pipeline.contacts_in_lemlist}
        sub={`de ${pipeline.contacts_imported.current} importados`}
      />
      <KpiCard
        icon={<IconPhone size={18} />}
        accent="success"
        title="Contactos con teléfono"
        delta={pipeline.contacts_with_phone}
        sub={`de ${pipeline.contacts_in_lemlist.current} en Lemlist`}
      />
      <KpiCard
        icon={<IconCloudUpload size={18} />}
        accent="warning"
        title="Sincronizados a HubSpot"
        delta={pipeline.contacts_in_hubspot}
        sub={`de ${pipeline.contacts_in_lemlist.current} en Lemlist`}
      />
    </div>
  );
}

type AccentColor = "brand" | "info" | "success" | "warning" | "danger";

const ACCENT_BG: Record<AccentColor, string> = {
  brand: "bg-brand-tint text-brand",
  info: "bg-info-bg text-info-fg",
  success: "bg-success-bg text-success-fg",
  warning: "bg-warning-bg text-warning-fg",
  danger: "bg-danger-bg text-danger-fg"
};

function KpiCard({
  icon,
  accent,
  title,
  delta,
  sub
}: {
  icon: React.ReactNode;
  accent: AccentColor;
  title: string;
  delta: Delta;
  sub?: string;
}) {
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${ACCENT_BG[accent]}`}>
          {icon}
        </div>
        <DeltaBadge delta={delta} />
      </div>
      <div>
        <div className="text-3xl font-semibold tracking-tight text-ink leading-none">
          {formatNumber(delta.current)}
        </div>
        <div className="text-sm text-ink-muted mt-1.5">{title}</div>
        {sub && <div className="text-[11px] text-ink-subtle mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: Delta }) {
  const { pct_change, previous } = delta;
  if (pct_change == null) {
    if (previous === 0 && delta.current > 0) {
      return (
        <span className="badge bg-success-bg text-success-fg">
          <IconTrendingUp size={11} /> nuevo
        </span>
      );
    }
    return null;
  }
  if (Math.abs(pct_change) < 0.5) {
    return (
      <span className="badge bg-ink-muted/10 text-ink-muted">
        <IconMinus size={11} /> 0%
      </span>
    );
  }
  if (pct_change > 0) {
    return (
      <span className="badge bg-success-bg text-success-fg" title={`Anterior: ${previous}`}>
        <IconTrendingUp size={11} /> {formatPct(Math.abs(pct_change))}
      </span>
    );
  }
  return (
    <span className="badge bg-danger-bg text-danger-fg" title={`Anterior: ${previous}`}>
      <IconTrendingDown size={11} /> {formatPct(Math.abs(pct_change))}
    </span>
  );
}

// ============================================================================
// Conversion rates (4 mini cards con barra)
// ============================================================================

function ConversionRates({ pipeline }: { pipeline: Dashboard["pipeline"] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <RateCard
        title="Aprobación de empresas"
        hint="aprobadas / descubiertas"
        pct={pipeline.approval_rate}
        color="#3D2878"
      />
      <RateCard
        title="Fit de contactos"
        hint="pre-filter YES / total"
        pct={pipeline.fit_rate}
        color="#7F77DD"
      />
      <RateCard
        title="Cobertura de teléfono"
        hint="con phone / en Lemlist"
        pct={pipeline.phone_rate}
        color="#0F6E56"
      />
      <RateCard
        title="Sincronización HubSpot"
        hint="en HubSpot / en Lemlist"
        pct={pipeline.hubspot_rate}
        color="#185FA5"
      />
    </div>
  );
}

function RateCard({
  title,
  hint,
  pct,
  color
}: {
  title: string;
  hint: string;
  pct: number | null;
  color: string;
}) {
  const pctSafe = pct ?? 0;
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="text-2xl font-semibold tracking-tight text-ink">
          {pct == null ? "—" : `${pctSafe.toFixed(1)}%`}
        </div>
      </div>
      <div className="h-1.5 w-full bg-brand-tint rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, Math.max(0, pctSafe))}%`, background: color }}
        />
      </div>
      <div className="text-[11px] text-ink-subtle">{hint}</div>
    </div>
  );
}

// ============================================================================
// Funnel
// ============================================================================

function FunnelCard({ funnel }: { funnel: Dashboard["funnel"] }) {
  const top = funnel[0]?.count ?? 1;
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <IconTargetArrow size={16} className="text-brand" />
        <h2 className="text-sm font-semibold text-ink">Embudo de prospección</h2>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Conversión paso a paso, desde discovery hasta HubSpot.
      </p>
      <div className="space-y-2">
        {funnel.map((f, i) => {
          const width = top === 0 ? 0 : Math.max(2, (f.count / top) * 100);
          return (
            <div key={f.step} className="flex items-center gap-3">
              <div className="w-44 shrink-0 text-xs text-ink-muted">{f.step}</div>
              <div className="flex-1 relative h-8 bg-brand-tint/50 rounded-md overflow-hidden">
                <div
                  className="h-full rounded-md transition-all flex items-center px-3"
                  style={{
                    width: `${width}%`,
                    background: `linear-gradient(90deg, #3D2878 ${100 - i * 12}%, #7F77DD)`
                  }}
                >
                  <span className="text-xs font-semibold text-white">
                    {formatNumber(f.count)}
                  </span>
                </div>
              </div>
              <div className="w-32 text-right shrink-0">
                {f.rate_from_prev != null ? (
                  <div className="text-xs">
                    <span className="font-medium text-ink">{f.rate_from_prev.toFixed(0)}%</span>
                    <span className="text-ink-subtle"> del anterior</span>
                  </div>
                ) : (
                  <div className="text-xs text-ink-subtle">—</div>
                )}
                {f.rate_from_top != null && (
                  <div className="text-[10px] text-ink-subtle">
                    {f.rate_from_top.toFixed(0)}% del top
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Distribuciones (donut-style con barras horizontales apiladas)
// ============================================================================

const COMPANY_PALETTE = ["#3D2878", "#7F77DD", "#0F6E56", "#854F0B", "#993C1D", "#9794AC"];
const PHONE_PALETTE = ["#0F6E56", "#185FA5", "#993C1D", "#9794AC"];
const ACTION_PALETTE = ["#0F6E56", "#854F0B", "#993C1D", "#9794AC"];

function DistributionCard({
  title,
  subtitle,
  icon,
  items,
  palette
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: Array<{ key: string; label: string; count: number }>;
  palette: string[];
}) {
  const total = items.reduce((a, b) => a + b.count, 0);
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        {icon}
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      <p className="text-xs text-ink-muted mb-4">{subtitle}</p>
      {total === 0 ? (
        <div className="text-sm text-ink-subtle py-4">Sin datos en este período.</div>
      ) : (
        <>
          {/* Barra apilada */}
          <div className="flex h-2.5 rounded-full overflow-hidden bg-brand-tint mb-4">
            {items.map((item, i) => {
              const pct = (item.count / total) * 100;
              return (
                <div
                  key={item.key}
                  className="transition-all"
                  style={{ width: `${pct}%`, background: palette[i % palette.length] }}
                  title={`${item.label}: ${item.count} (${pct.toFixed(1)}%)`}
                />
              );
            })}
          </div>
          {/* Leyenda */}
          <div className="space-y-1.5">
            {items.map((item, i) => {
              const pct = (item.count / total) * 100;
              return (
                <div key={item.key} className="flex items-center gap-2 text-xs">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: palette[i % palette.length] }}
                  />
                  <span className="flex-1 text-ink">{item.label}</span>
                  <span className="text-ink-muted tabular-nums">
                    {item.count} <span className="text-ink-subtle">({pct.toFixed(0)}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function FitActionsCard({
  items
}: {
  items: Array<{ key: string; label: string; count: number }>;
}) {
  return (
    <DistributionCard
      title="Acción IA por contacto"
      subtitle="Veredicto de Claude Lead Scoring"
      icon={<IconCircleDot size={16} />}
      items={items}
      palette={ACTION_PALETTE}
    />
  );
}

// ============================================================================
// Quality card
// ============================================================================

function QualityCard({ quality }: { quality: Dashboard["quality"] }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconChartBar size={16} />
        <h2 className="text-sm font-semibold text-ink">Calidad del filtro</h2>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Trabajo pendiente y tasa de descarte humano en revisión manual.
      </p>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-ink-muted">Revisión manual pendiente</div>
            <div className="text-2xl font-semibold text-ink tabular-nums">
              {quality.manual_review_pending}
            </div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-warning-bg text-warning-fg flex items-center justify-center">
            <IconClipboardList size={18} />
          </div>
        </div>
        <div className="border-t border-[#EEEDFE] pt-3">
          <div className="text-xs text-ink-muted">Humano descartó (de los manuales decididos)</div>
          <div className="text-2xl font-semibold text-ink tabular-nums">
            {quality.human_agreement_rate == null
              ? "—"
              : `${quality.human_agreement_rate.toFixed(0)}%`}
          </div>
          <div className="text-[11px] text-ink-subtle mt-0.5">
            Más alto = Claude estaba inseguro y el humano dijo NO.
          </div>
        </div>
      </div>
    </div>
  );
}

function DiscardReasonsCard({
  reasons
}: {
  reasons: Array<{ reason: string; count: number }>;
}) {
  const max = Math.max(1, ...reasons.map((r) => r.count));
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconCheck size={16} />
        <h2 className="text-sm font-semibold text-ink">Top razones de descarte</h2>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Por qué Claude descartó contactos en este período.
      </p>
      {reasons.length === 0 ? (
        <div className="text-sm text-ink-subtle py-4">Sin descartes en este período.</div>
      ) : (
        <div className="space-y-2">
          {reasons.map((r) => (
            <div key={r.reason}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-ink truncate" title={r.reason}>
                  {r.reason}
                </span>
                <span className="text-ink-muted tabular-nums shrink-0">{r.count}</span>
              </div>
              <div className="h-1.5 w-full bg-brand-tint rounded-full overflow-hidden mt-1">
                <div
                  className="h-full bg-brand-soft rounded-full transition-all"
                  style={{ width: `${(r.count / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Activity sparkline
// ============================================================================

function ActivityCard({ activity }: { activity: Dashboard["activity"] }) {
  const labels = activity.map((a) => a.date);
  const companies = activity.map((a) => a.companies_approved);
  const contacts = activity.map((a) => a.contacts_imported);
  const totalCompanies = companies.reduce((a, b) => a + b, 0);
  const totalContacts = contacts.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...companies, ...contacts);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 text-brand">
            <IconCalendarStats size={16} />
            <h2 className="text-sm font-semibold text-ink">Actividad en el tiempo</h2>
          </div>
          <p className="text-xs text-ink-muted mt-0.5">
            Empresas aprobadas y contactos importados por día.
          </p>
        </div>
        <div className="flex gap-4 text-xs">
          <LegendDot color="#3D2878" label="Empresas aprobadas" value={totalCompanies} />
          <LegendDot color="#7F77DD" label="Contactos importados" value={totalContacts} />
        </div>
      </div>
      {labels.length === 0 ? (
        <div className="text-sm text-ink-subtle py-4">Sin actividad en este período.</div>
      ) : (
        <Sparkline labels={labels} series={[
          { color: "#3D2878", values: companies },
          { color: "#7F77DD", values: contacts }
        ]} max={max} />
      )}
    </div>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      <span className="text-ink-muted">{label}</span>
      <span className="font-semibold text-ink tabular-nums">{value}</span>
    </div>
  );
}

function Sparkline({
  labels,
  series,
  max
}: {
  labels: string[];
  series: Array<{ color: string; values: number[] }>;
  max: number;
}) {
  const w = 100;
  const h = 24;
  const stepX = labels.length > 1 ? w / (labels.length - 1) : w;
  const yScale = (v: number) => h - (v / max) * (h - 2) - 1;

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
        {series.map((s, idx) => {
          const points = s.values.map((v, i) => `${i * stepX},${yScale(v)}`).join(" ");
          const area = `${points} ${(labels.length - 1) * stepX},${h} 0,${h}`;
          return (
            <g key={idx}>
              <polygon points={area} fill={s.color} opacity={0.08} />
              <polyline
                points={points}
                fill="none"
                stroke={s.color}
                strokeWidth={0.6}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {s.values.map((v, i) =>
                v > 0 ? (
                  <circle
                    key={i}
                    cx={i * stepX}
                    cy={yScale(v)}
                    r={0.8}
                    fill={s.color}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-ink-subtle">
        <span>{formatShortDate(labels[0])}</span>
        {labels.length > 8 && (
          <span>{formatShortDate(labels[Math.floor(labels.length / 2)])}</span>
        )}
        <span>{formatShortDate(labels[labels.length - 1])}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Loading state
// ============================================================================

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-9 w-9 bg-brand-tint rounded-lg mb-3" />
            <div className="h-8 w-24 bg-brand-tint rounded mb-2" />
            <div className="h-3 w-32 bg-brand-tint/60 rounded" />
          </div>
        ))}
      </div>
      <div className="card animate-pulse h-64" />
      <div className="card animate-pulse h-48" />
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatNumber(n: number): string {
  return new Intl.NumberFormat("es-ES").format(n);
}

function formatPct(n: number): string {
  if (n >= 100) return `${Math.round(n)}%`;
  if (n >= 10) return `${n.toFixed(0)}%`;
  return `${n.toFixed(1)}%`;
}

function formatRangeWindow(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" });
  return `${fmt.format(start)} → ${fmt.format(end)}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" }).format(d);
}
