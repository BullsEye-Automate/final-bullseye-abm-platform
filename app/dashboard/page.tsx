"use client";

import { useEffect, useState, useCallback } from "react";
import { useClient } from "@/lib/clientContext";
import type { DashboardData, Delta } from "@/lib/dashboardQueries";
import { RangeKey, RANGE_LABELS } from "@/lib/dashboardRanges";
import { IconAlertCircle, IconAlertTriangle } from "@tabler/icons-react";

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  delta,
  sub
}: {
  label: string;
  value: number | string;
  delta: Delta;
  sub?: string;
}) {
  const pct = delta.pct_change;
  const arrow = pct == null ? "" : pct > 0 ? "↑" : pct < 0 ? "↓" : "→";
  const color =
    pct == null ? "#6B6884" : pct > 0 ? "#0F6E56" : pct < 0 ? "#993C1D" : "#6B6884";
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="text-3xl font-bold text-ink mt-1">{value}</div>
      <div className="text-xs mt-1.5 flex items-center gap-1" style={{ color }}>
        <span>{arrow}</span>
        <span>
          {pct == null
            ? "sin datos previos"
            : `${Math.abs(pct).toFixed(0)}% vs período anterior`}
        </span>
      </div>
      {sub && <div className="text-xs text-ink-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function RateCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="text-2xl font-bold text-ink mt-1">
        {value == null ? "—" : `${value.toFixed(0)}%`}
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
        <div
          className="h-1.5 rounded-full"
          style={{
            width: `${Math.min(value ?? 0, 100)}%`,
            background: "#62E0D8"
          }}
        />
      </div>
    </div>
  );
}

function Funnel({ steps }: { steps: DashboardData["funnel"] }) {
  const max = Math.max(...steps.map((s) => s.count), 1);
  return (
    <div className="card">
      <h2 className="font-semibold mb-4">Funnel de conversión</h2>
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={s.step} className="flex items-center gap-3">
            <div className="w-24 text-xs text-ink-muted text-right shrink-0">{s.step}</div>
            <div className="flex-1 bg-gray-100 rounded-full h-5 relative">
              <div
                className="h-5 rounded-full flex items-center px-2"
                style={{
                  width: `${(s.count / max) * 100}%`,
                  background: i === 0 ? "#251762" : "#62E0D8",
                  minWidth: s.count > 0 ? "2rem" : 0
                }}
              >
                {s.count > 0 && (
                  <span className="text-[11px] font-medium text-white">{s.count}</span>
                )}
              </div>
            </div>
            {s.rate_from_prev != null && (
              <div className="w-12 text-xs text-ink-muted text-right shrink-0">
                {s.rate_from_prev.toFixed(0)}%
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Sparkline({
  data,
  key1,
  key2,
  color1,
  color2
}: {
  data: DashboardData["activity"];
  key1: keyof DashboardData["activity"][0];
  key2: keyof DashboardData["activity"][0];
  color1: string;
  color2: string;
}) {
  if (!data.length) return null;
  const vals1 = data.map((d) => d[key1] as number);
  const vals2 = data.map((d) => d[key2] as number);
  const max = Math.max(...vals1, ...vals2, 1);
  const W = 400;
  const H = 80;
  const xs = data.map((_, i) => (i / Math.max(data.length - 1, 1)) * W);
  const y = (v: number) => H - (v / max) * H * 0.9;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16">
      <polyline
        points={data.map((_, i) => `${xs[i]},${y(vals1[i])}`).join(" ")}
        fill="none"
        stroke={color1}
        strokeWidth="2"
      />
      <polyline
        points={data.map((_, i) => `${xs[i]},${y(vals2[i])}`).join(" ")}
        fill="none"
        stroke={color2}
        strokeWidth="2"
        strokeDasharray="4"
      />
    </svg>
  );
}

function EvolutionChart({ data }: { data: DashboardData["evolution_8mo"] }) {
  if (!data.length) return null;
  const maxVal = Math.max(...data.map((d) => Math.max(d.companies_clay_push, d.contacts_total)), 1);
  const H = 100;
  const barW = 16;
  const gap = 8;
  const colW = barW * 2 + gap + 8;

  return (
    <div className="card">
      <h2 className="font-semibold mb-4">Evolución 8 meses</h2>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${data.length * colW} ${H + 30}`}
          className="w-full"
          style={{ minWidth: data.length * colW }}
        >
          {data.map((d, i) => {
            const x = i * colW;
            const h1 = Math.max((d.companies_clay_push / maxVal) * H, 1);
            const h2 = Math.max((d.contacts_total / maxVal) * H, 1);
            return (
              <g key={d.month}>
                {/* Barra empresas */}
                <rect
                  x={x}
                  y={H - h1}
                  width={barW}
                  height={h1}
                  fill="#251762"
                  rx="2"
                />
                {/* Barra contactos */}
                <rect
                  x={x + barW + gap}
                  y={H - h2}
                  width={barW}
                  height={h2}
                  fill="#62E0D8"
                  rx="2"
                />
                {/* Etiqueta mes */}
                <text
                  x={x + barW + gap / 2}
                  y={H + 18}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#6B6884"
                >
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {/* Leyenda */}
      <div className="flex items-center gap-4 mt-2 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#251762" }} />
          Empresas Clay
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#62E0D8" }} />
          Contactos total
        </span>
      </div>
    </div>
  );
}

function DistributionList({
  title,
  items
}: {
  title: string;
  items: Array<{ key: string; label: string; count: number }>;
}) {
  const total = items.reduce((s, i) => s + i.count, 0);
  return (
    <div className="card">
      <h2 className="font-semibold mb-4">{title}</h2>
      {items.length === 0 ? (
        <div className="text-sm text-ink-muted">Sin datos en este período.</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const pct = total === 0 ? 0 : (item.count / total) * 100;
            return (
              <div key={item.key} className="flex items-center gap-3">
                <div className="w-28 text-xs text-ink-muted text-right shrink-0 truncate">
                  {item.label}
                </div>
                <div className="flex-1 bg-gray-100 rounded-full h-3">
                  <div
                    className="h-3 rounded-full"
                    style={{ width: `${pct}%`, background: "#62E0D8", minWidth: item.count > 0 ? "4px" : 0 }}
                  />
                </div>
                <div className="w-8 text-xs text-ink-muted text-right shrink-0">{item.count}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* KPI skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="animate-pulse bg-gray-100 rounded-xl h-28" />
        ))}
      </div>
      {/* Rate skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="animate-pulse bg-gray-100 rounded-xl h-28" />
        ))}
      </div>
      {/* Funnel skeleton */}
      <div className="animate-pulse bg-gray-100 rounded-xl h-48" />
      {/* Two columns skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="animate-pulse bg-gray-100 rounded-xl h-40" />
        <div className="animate-pulse bg-gray-100 rounded-xl h-40" />
      </div>
      {/* Chart skeleton */}
      <div className="animate-pulse bg-gray-100 rounded-xl h-48" />
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { currentClient } = useClient();
  const [rangeKey, setRangeKey] = useState<RangeKey>("this_month");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [phoneRefreshBusy, setPhoneRefreshBusy] = useState(false);
  const [phoneRefreshMsg, setPhoneRefreshMsg] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!currentClient) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const url = `/api/dashboard?range=${rangeKey}&client_id=${currentClient.id}`;
        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Error al cargar el dashboard.");
          return;
        }
        setData(json);
      } catch (e: any) {
        setError(e.message ?? "Error de red.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [rangeKey, currentClient]
  );

  useEffect(() => {
    if (currentClient) {
      load();
    } else {
      setData(null);
    }
  }, [rangeKey, currentClient?.id]);

  async function handlePhoneRefresh() {
    setPhoneRefreshBusy(true);
    setPhoneRefreshMsg(null);
    try {
      const res = await fetch("/api/lemlist/refresh-phones", { method: "POST" });
      const json = await res.json();
      setPhoneRefreshMsg(json.message ?? "Sincronización iniciada.");
    } catch {
      setPhoneRefreshMsg("Error al iniciar sincronización.");
    } finally {
      setPhoneRefreshBusy(false);
    }
  }

  // Mostrar banner de teléfonos
  const showPhoneRefreshBanner =
    data != null &&
    data.pipeline.contacts_in_lemlist.current > 5 &&
    data.pipeline.contacts_with_phone.current /
      data.pipeline.contacts_in_lemlist.current <
      0.5;

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-end justify-between mb-6">
        <div>
          <div className="label">Análisis</div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard operativo</h1>
          {currentClient && (
            <span
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white mt-1"
              style={{ background: "#251762" }}
            >
              {currentClient.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            className="input py-1.5 text-sm"
            value={rangeKey}
            onChange={(e) => setRangeKey(e.target.value as RangeKey)}
          >
            {Object.entries(RANGE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary py-1.5"
            onClick={() => load(true)}
            disabled={loading || refreshing}
          >
            {refreshing ? "…" : "↺"}
          </button>
        </div>
      </header>

      {/* ── Sin cliente seleccionado ─────────────────────────────────────── */}
      {!currentClient && (
        <div
          className="card border flex items-center gap-3 text-sm"
          style={{ borderColor: "#F0C060", background: "#FFFBE6", color: "#7A5F00" }}
        >
          <IconAlertTriangle size={16} className="shrink-0" />
          Selecciona un cliente en el sidebar para ver el dashboard operativo.
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="card border border-red-200 flex items-center gap-2 text-red-700 text-sm">
          <IconAlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {/* ── Skeleton mientras carga ──────────────────────────────────────── */}
      {loading && <LoadingSkeleton />}

      {/* ── Contenido principal ──────────────────────────────────────────── */}
      {!loading && data && (
        <div className="max-w-6xl mx-auto space-y-6">

          {/* 1. Hero KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Empresas descubiertas"
              value={data.pipeline.companies_discovered.current}
              delta={data.pipeline.companies_discovered}
            />
            <KpiCard
              label="Aprobadas"
              value={data.pipeline.companies_approved.current}
              delta={data.pipeline.companies_approved}
            />
            <KpiCard
              label="Contactos importados"
              value={data.pipeline.contacts_imported.current}
              delta={data.pipeline.contacts_imported}
            />
            <KpiCard
              label="En Lemlist"
              value={data.pipeline.contacts_in_lemlist.current}
              delta={data.pipeline.contacts_in_lemlist}
              sub={
                data.pipeline.contacts_with_phone.current > 0
                  ? `${data.pipeline.contacts_with_phone.current} con teléfono`
                  : undefined
              }
            />
          </div>

          {/* 2. Rate mini-cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <RateCard label="Tasa de aprobación" value={data.pipeline.approval_rate} />
            <RateCard label="Fit rate / YES" value={data.pipeline.fit_rate} />
            <RateCard label="Tasa de teléfono" value={data.pipeline.phone_rate} />
            <RateCard label="Tasa HubSpot" value={data.pipeline.hubspot_rate} />
          </div>

          {/* 3. Funnel */}
          <Funnel steps={data.funnel} />

          {/* 4. Coverage + Clay funnel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Coverage */}
            <div className="card">
              <h2 className="font-semibold mb-4">Cobertura de contactos</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-ink-muted">Total en Clay</span>
                  <span className="font-semibold">{data.coverage.total_in_clay}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">Sin contactos</span>
                  <span className="font-semibold text-red-600">{data.coverage.no_contacts}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">1 contacto</span>
                  <span className="font-semibold text-amber-600">{data.coverage.one_contact}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">2+ contactos</span>
                  <span className="font-semibold text-green-700">{data.coverage.two_plus_contacts}</span>
                </div>
                {data.usage.avg_contacts_per_company != null && (
                  <div
                    className="flex justify-between pt-2 mt-2"
                    style={{ borderTop: "1px solid #F1EEF7" }}
                  >
                    <span className="text-ink-muted">Promedio por empresa</span>
                    <span className="font-semibold">
                      {data.usage.avg_contacts_per_company.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Clay funnel */}
            <div className="card">
              <h2 className="font-semibold mb-4">Funnel Clay</h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "De Clay", value: data.clay_funnel.total_from_clay },
                  { label: "Fit (YES)", value: data.clay_funnel.fit },
                  { label: "En Lemlist", value: data.clay_funnel.in_lemlist }
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl p-4 text-center"
                    style={{ background: "#F4F2FB" }}
                  >
                    <div className="text-2xl font-bold text-ink">{item.value}</div>
                    <div className="text-xs text-ink-muted mt-1">{item.label}</div>
                  </div>
                ))}
              </div>
              {data.clay_funnel.total_from_clay > 0 && (
                <div className="mt-3 text-xs text-ink-muted text-center">
                  {((data.clay_funnel.in_lemlist / data.clay_funnel.total_from_clay) * 100).toFixed(0)}% de Clay llegó a Lemlist
                </div>
              )}
            </div>
          </div>

          {/* 5. Gráfico de evolución 8 meses */}
          <EvolutionChart data={data.evolution_8mo} />

          {/* 6. Distribuciones */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DistributionList
              title="Tipos de empresa"
              items={data.distribution.company_types}
            />
            <DistributionList
              title="Acciones IA (fit_action)"
              items={data.distribution.fit_actions}
            />
          </div>

          {/* 7. Calidad */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Acuerdo humano */}
            <div className="card">
              <h2 className="font-semibold mb-3">Acuerdo humano con IA</h2>
              {data.quality.human_agreement_rate == null ? (
                <div className="text-sm text-ink-muted">Sin datos en este período.</div>
              ) : (
                <>
                  <div className="text-3xl font-bold text-ink">
                    {data.quality.human_agreement_rate.toFixed(0)}%
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 mt-3">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${Math.min(data.quality.human_agreement_rate, 100)}%`,
                        background: "#62E0D8"
                      }}
                    />
                  </div>
                  <div className="text-xs text-ink-muted mt-2">
                    Porcentaje de contactos marcados "enrich" por IA que el humano aprobó.
                  </div>
                </>
              )}
            </div>

            {/* Razones de descarte */}
            <div className="card">
              <h2 className="font-semibold mb-3">Top razones de descarte</h2>
              {data.quality.discard_reasons.length === 0 ? (
                <div className="text-sm text-ink-muted">Sin descartes registrados.</div>
              ) : (
                <ol className="space-y-1.5">
                  {data.quality.discard_reasons.map((r, i) => (
                    <li key={r.reason} className="flex items-start gap-2 text-sm">
                      <span
                        className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white"
                        style={{ background: "#251762" }}
                      >
                        {i + 1}
                      </span>
                      <span className="text-ink/90 capitalize">{r.reason}</span>
                      <span className="ml-auto text-xs text-ink-muted shrink-0">{r.count}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          {/* 8. Actividad diaria (sparkline) */}
          {data.activity.length > 0 && (
            <div className="card">
              <h2 className="font-semibold mb-3">Actividad diaria</h2>
              <Sparkline
                data={data.activity}
                key1="companies_approved"
                key2="contacts_imported"
                color1="#251762"
                color2="#62E0D8"
              />
              {/* Etiquetas de fecha inicio/fin */}
              <div className="flex justify-between text-[10px] text-ink-muted mt-1">
                <span>{data.activity[0]?.date}</span>
                <span>{data.activity[data.activity.length - 1]?.date}</span>
              </div>
              {/* Leyenda */}
              <div className="flex items-center gap-4 mt-2 text-xs text-ink-muted">
                <span className="flex items-center gap-1.5">
                  <svg width="20" height="8">
                    <line x1="0" y1="4" x2="20" y2="4" stroke="#251762" strokeWidth="2" />
                  </svg>
                  Empresas aprobadas
                </span>
                <span className="flex items-center gap-1.5">
                  <svg width="20" height="8">
                    <line
                      x1="0"
                      y1="4"
                      x2="20"
                      y2="4"
                      stroke="#62E0D8"
                      strokeWidth="2"
                      strokeDasharray="4"
                    />
                  </svg>
                  Contactos importados
                </span>
              </div>
            </div>
          )}

          {/* 9. Banner de teléfonos */}
          {showPhoneRefreshBanner && (
            <div
              className="card border flex items-center justify-between gap-4"
              style={{ borderColor: "#F0C060", background: "#FFFBE6" }}
            >
              <div className="flex items-center gap-3">
                <IconAlertTriangle size={18} style={{ color: "#B8860B" }} className="shrink-0" />
                <div>
                  <div className="font-semibold text-sm" style={{ color: "#7A5F00" }}>
                    Sincronizar teléfonos
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "#A07A00" }}>
                    Lemlist enriquece async. Solo{" "}
                    {data.pipeline.contacts_with_phone.current} de{" "}
                    {data.pipeline.contacts_in_lemlist.current} contactos tienen teléfono.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {phoneRefreshMsg && (
                  <span className="text-xs" style={{ color: "#7A5F00" }}>
                    {phoneRefreshMsg}
                  </span>
                )}
                <button
                  onClick={handlePhoneRefresh}
                  disabled={phoneRefreshBusy}
                  className="btn-secondary text-sm"
                  style={{ borderColor: "#F0C060" }}
                >
                  {phoneRefreshBusy ? "…" : "Sincronizar ahora"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
