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
  IconClipboardList,
  IconCompass
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
  coverage: {
    total_in_clay: number;
    no_contacts: number;
    one_contact: number;
    two_plus_contacts: number;
    no_fit_marked: number;
    manually_worked: number;
  };
  usage: {
    total_companies_worked: number;
    clay_companies: number;
    clay_contacts: number;
    sales_nav_companies: number;
    sales_nav_contacts: number;
    avg_contacts_per_company: number | null;
  };
  evolution_8mo: Array<{
    month: string;
    label: string;
    companies_clay_push: number;
    contacts_from_clay: number;
    contacts_from_sales_nav: number;
    contacts_total: number;
  }>;
  provider_usage: Array<{
    name: string;
    operations_label: string;
    operations: number;
    estimated_cost_usd: number | null;
    note: string;
  }>;
  clay_funnel: {
    total_from_clay: number;
    fit: number;
    manual_review: number;
    manual_review_approved: number;
    in_lemlist: number;
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
          <CoverageCard coverage={data.coverage} />
          <UsageCard usage={data.usage} rangeLabel={data.range.label} />
          <EvolutionCard months={data.evolution_8mo} />
          <ClayFunnelCard funnel={data.clay_funnel} rangeLabel={data.range.label} />
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
          <ProviderUsageCard
            providers={data.provider_usage}
            rangeLabel={data.range.label}
          />
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
// Usage card — métricas mensuales del equipo (range-bound)
// ============================================================================

function UsageCard({
  usage,
  rangeLabel
}: {
  usage: Dashboard["usage"];
  rangeLabel: string;
}) {
  const items: Array<{
    label: string;
    value: string | number;
    hint?: string;
  }> = [
    {
      label: "Empresas trabajadas",
      value: usage.total_companies_worked,
      hint: "Empresas que se mandaron a Clay en el período"
    },
    {
      label: "Empresas con resultado Clay",
      value: usage.clay_companies,
      hint: "Únicas con ≥1 contacto encontrado por Clay en el período"
    },
    {
      label: "Contactos encontrados por Clay",
      value: usage.clay_contacts
    },
    {
      label: "Empresas con resultado Sales Nav",
      value: usage.sales_nav_companies,
      hint: "Únicas con ≥1 contacto importado manualmente en el período"
    },
    {
      label: "Contactos encontrados por Sales Nav",
      value: usage.sales_nav_contacts
    },
    {
      label: "Promedio contactos por empresa",
      value:
        usage.avg_contacts_per_company == null
          ? "—"
          : usage.avg_contacts_per_company.toFixed(1),
      hint: "Total contactos / empresas únicas con ≥1 contacto"
    }
  ];
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconChartBar size={16} />
        <h2 className="text-sm font-semibold text-ink">
          Uso del equipo · {rangeLabel}
        </h2>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Para medir gestión mensual del equipo de prospección. Filtrado por el
        rango seleccionado arriba.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {items.map((it) => (
          <div key={it.label} className="space-y-0.5">
            <div className="text-2xl font-semibold text-ink tabular-nums">
              {it.value}
            </div>
            <div className="text-xs text-ink-muted">{it.label}</div>
            {it.hint && (
              <div className="text-[10px] text-ink-subtle leading-tight">
                {it.hint}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Provider usage card — uso estimado de APIs externas (range-bound)
// ============================================================================

function ProviderUsageCard({
  providers,
  rangeLabel
}: {
  providers: Dashboard["provider_usage"];
  rangeLabel: string;
}) {
  const totalCost = providers.reduce(
    (acc, p) => acc + (p.estimated_cost_usd ?? 0),
    0
  );
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconChartBar size={16} />
        <h2 className="text-sm font-semibold text-ink">
          Uso de APIs externas (estimado) · {rangeLabel}
        </h2>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Estimaciones a partir de operaciones contadas en la app, multiplicadas
        por costo aproximado por operación. NO son números de billing reales —
        verificar en cada proveedor para confirmación.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-ink-muted border-b border-[#EEEDFE]">
              <th className="text-left py-2 pr-4 font-medium">Proveedor</th>
              <th className="text-left py-2 pr-4 font-medium">Operación contada</th>
              <th className="text-right py-2 pr-4 font-medium">Cantidad</th>
              <th className="text-right py-2 font-medium">Estimación USD</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.name} className="border-b border-[#F4F2FB] last:border-0">
                <td className="py-2 pr-4 font-medium text-ink">{p.name}</td>
                <td className="py-2 pr-4 text-ink-muted text-xs">
                  <div>{p.operations_label}</div>
                  <div className="text-ink-subtle text-[10px] leading-tight mt-0.5">
                    {p.note}
                  </div>
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-ink">
                  {p.operations.toLocaleString("es")}
                </td>
                <td className="py-2 text-right tabular-nums text-ink">
                  {p.estimated_cost_usd == null
                    ? "—"
                    : `$${p.estimated_cost_usd.toFixed(2)}`}
                </td>
              </tr>
            ))}
            <tr className="font-semibold text-ink">
              <td className="py-2 pr-4">Total estimado</td>
              <td></td>
              <td></td>
              <td className="py-2 text-right tabular-nums">${totalCost.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Evolution card — últimos 8 meses, empresas trabajadas + contactos por fuente
// ============================================================================

function EvolutionCard({ months }: { months: Dashboard["evolution_8mo"] }) {
  const maxCompanies = Math.max(1, ...months.map((m) => m.companies_clay_push));
  const maxContacts = Math.max(
    1,
    ...months.map((m) => m.contacts_from_clay + m.contacts_from_sales_nav)
  );
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconCalendarStats size={16} />
        <h2 className="text-sm font-semibold text-ink">
          Evolución mensual · últimos 8 meses
        </h2>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Empresas que entraron al sistema (push a Clay) y contactos encontrados
        cada mes, separados por fuente. No filtrado por rango — siempre los
        últimos 8 meses calendario.
      </p>
      <div className="flex items-center gap-4 mb-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-brand" />
          <span className="text-ink-muted">Empresas (push a Clay)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-success-fg" />
          <span className="text-ink-muted">Contactos de Clay</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-warning-fg" />
          <span className="text-ink-muted">Contactos de Sales Nav</span>
        </div>
      </div>
      <div className="grid grid-cols-8 gap-2">
        {months.map((m) => {
          const totalContacts = m.contacts_from_clay + m.contacts_from_sales_nav;
          const companiesPct = (m.companies_clay_push / maxCompanies) * 100;
          const clayPct = (m.contacts_from_clay / maxContacts) * 100;
          const snPct = (m.contacts_from_sales_nav / maxContacts) * 100;
          return (
            <div key={m.month} className="flex flex-col items-center gap-1.5">
              <div className="text-[10px] text-ink-subtle tabular-nums">
                {totalContacts > 0 ? `${totalContacts}c` : ""}
              </div>
              <div className="w-full h-32 flex items-end gap-1">
                {/* Barra empresas */}
                <div className="flex-1 flex flex-col justify-end">
                  <div
                    className="bg-brand rounded-t"
                    style={{ height: `${companiesPct}%` }}
                    title={`${m.companies_clay_push} empresas pushed a Clay`}
                  />
                </div>
                {/* Barra contactos apilada (Clay verde abajo, SN amarillo arriba) */}
                <div className="flex-1 flex flex-col justify-end">
                  <div
                    className="bg-warning-fg"
                    style={{ height: `${snPct}%` }}
                    title={`${m.contacts_from_sales_nav} contactos de Sales Nav`}
                  />
                  <div
                    className="bg-success-fg rounded-t"
                    style={{
                      height: `${clayPct}%`,
                      borderTopLeftRadius: snPct > 0 ? 0 : 2,
                      borderTopRightRadius: snPct > 0 ? 0 : 2
                    }}
                    title={`${m.contacts_from_clay} contactos de Clay`}
                  />
                </div>
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

// ============================================================================
// Clay funnel card — embudo de contactos levantados por Clay (range-bound)
// ============================================================================

function ClayFunnelCard({
  funnel,
  rangeLabel
}: {
  funnel: Dashboard["clay_funnel"];
  rangeLabel: string;
}) {
  const top = funnel.total_from_clay || 1;
  const pct = (n: number) => (n / top) * 100;
  const fmtPct = (n: number, d: number) =>
    d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
  const steps = [
    {
      label: "Levantados por Clay",
      count: funnel.total_from_clay,
      subtitle: "Find People + Enrich Person",
      rate: "100%",
      cls: "bg-brand"
    },
    {
      label: "Marcados fit por Clay AI",
      count: funnel.fit,
      subtitle: "Lead Scoring action = enrich",
      rate: fmtPct(funnel.fit, funnel.total_from_clay) + " del total",
      cls: "bg-success-fg"
    },
    {
      label: "En revisión manual",
      count: funnel.manual_review,
      subtitle: "Lead Scoring action = manual_review",
      rate: fmtPct(funnel.manual_review, funnel.total_from_clay) + " del total",
      cls: "bg-warning-fg"
    },
    {
      label: "Manual review aprobados",
      count: funnel.manual_review_approved,
      subtitle: "Aprobados manualmente del bucket anterior",
      rate:
        funnel.manual_review > 0
          ? fmtPct(funnel.manual_review_approved, funnel.manual_review) +
            " del manual review"
          : "—",
      cls: "bg-warning-fg/70"
    },
    {
      label: "En campaña Lemlist",
      count: funnel.in_lemlist,
      subtitle: "lemlist_pushed_at — outreach activo",
      rate: fmtPct(funnel.in_lemlist, funnel.total_from_clay) + " del total",
      cls: "bg-brand-soft"
    }
  ];
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconChartBar size={16} />
        <h2 className="text-sm font-semibold text-ink">
          Embudo de contactos levantados por Clay · {rangeLabel}
        </h2>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Solo contactos con <code className="text-[11px]">source=&apos;clay&apos;</code>{" "}
        creados en el período. Permite ver dónde se está perdiendo volumen en
        el pipeline.
      </p>
      <div className="space-y-2">
        {steps.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-48 shrink-0">
              <div className="text-sm font-medium text-ink">{s.label}</div>
              <div className="text-[10px] text-ink-subtle leading-tight">
                {s.subtitle}
              </div>
            </div>
            <div className="flex-1 relative h-7 bg-[#F1EEF7] rounded overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 ${s.cls}`}
                style={{ width: `${pct(s.count)}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-end px-2 text-xs font-medium text-ink tabular-nums">
                {s.count}
              </div>
            </div>
            <div className="w-32 text-xs text-ink-muted text-right shrink-0">
              {s.rate}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Coverage card — cobertura de contactos por empresa + resumen Sales Navigator
// ============================================================================

function CoverageCard({ coverage }: { coverage: Dashboard["coverage"] }) {
  const total = coverage.total_in_clay || 1;
  const bars = [
    {
      label: "Sin contactos",
      count: coverage.no_contacts,
      cls: "bg-danger-fg/80 text-white",
      barCls: "bg-danger-fg",
      hint: "Clay no encontró a nadie — buscar en Sales Nav"
    },
    {
      label: "Con 1 contacto",
      count: coverage.one_contact,
      cls: "bg-warning-fg/80 text-white",
      barCls: "bg-warning-fg",
      hint: "Solo 1 decision-maker — buscar más en Sales Nav"
    },
    {
      label: "Con 2 o más",
      count: coverage.two_plus_contacts,
      cls: "bg-success-fg/80 text-white",
      barCls: "bg-success-fg",
      hint: "Cobertura sana — no requiere trabajo manual"
    },
    {
      label: "Marcadas sin contactos fit",
      count: coverage.no_fit_marked,
      cls: "bg-ink-muted/80 text-white",
      barCls: "bg-ink-muted",
      hint: "Trabajadas en Sales Nav y descartadas"
    }
  ];
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1 text-brand">
        <IconCompass size={16} />
        <h2 className="text-sm font-semibold text-ink">
          Cobertura de empresas totales · Sales Navigator
        </h2>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Estado actual (no filtrado por rango). Empresas que pasaron por Clay
        agrupadas por cuántos decision-makers encontramos.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {bars.map((b) => (
          <div key={b.label} className="space-y-1">
            <div className="text-2xl font-semibold text-ink tabular-nums">{b.count}</div>
            <div className="text-xs text-ink-muted">{b.label}</div>
            <div className="text-[10px] text-ink-subtle leading-tight">{b.hint}</div>
            <div className="h-1.5 bg-[#F1EEF7] rounded-full overflow-hidden mt-1">
              <div
                className={`h-full ${b.barCls}`}
                style={{ width: `${(b.count / total) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-3 border-t border-[#EEEDFE] text-xs text-ink-muted">
        <div>
          <span className="text-ink-subtle">Total que pasó por Clay:</span>{" "}
          <span className="text-ink font-semibold tabular-nums">{coverage.total_in_clay}</span>
        </div>
        <div>
          <span className="text-ink-subtle">Trabajadas manualmente en Sales Nav:</span>{" "}
          <span className="text-ink font-semibold tabular-nums">{coverage.manually_worked}</span>
          <span className="text-ink-subtle">
            {" "}
            ({coverage.total_in_clay
              ? Math.round((coverage.manually_worked / coverage.total_in_clay) * 100)
              : 0}
            %)
          </span>
        </div>
      </div>
    </div>
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
