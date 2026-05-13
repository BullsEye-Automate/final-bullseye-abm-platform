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
  IconStarFilled
} from "@tabler/icons-react";
import { RANGE_LABELS, RANGE_ORDER, type RangeKey } from "@/lib/dashboardRanges";

type Report = {
  range: { key: string; label: string; start: string; end: string };
  totals: { calls: number; analyzed: number; avg_score: number | null };
  sub_scores: {
    opening: number | null;
    discovery: number | null;
    objection_handling: number | null;
    next_step: number | null;
  };
  response_distribution: Array<{ key: string; label: string; count: number }>;
  sdr_ranking: Array<{
    hubspot_owner_id: string;
    name: string;
    calls: number;
    analyzed: number;
    avg_score: number | null;
    interested: number;
    interested_rate: number | null;
  }>;
  top_improvement_areas: Array<{ area: string; count: number }>;
  activity: Array<{ date: string; calls: number; avg_score: number | null }>;
};

export default function ReporteLlamadasPage() {
  const [range, setRange] = useState<RangeKey>("this_month");
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (k: RangeKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calls/report?range=${k}`);
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
      <div className="flex items-center justify-between gap-3">
        <Link href="/llamadas" className="btn-secondary text-sm">
          <IconArrowLeft size={14} /> Volver a llamadas
        </Link>
        <div className="flex items-center gap-2">
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
          <button onClick={() => load(range)} disabled={loading} className="btn-secondary text-sm">
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
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <div className="card">
        <div className="label">Total llamadas</div>
        <div className="text-3xl font-semibold tracking-tight mt-1">{data.totals.calls}</div>
        <div className="text-xs text-ink-muted mt-1">
          {data.totals.analyzed} analizadas con IA
        </div>
      </div>
      <div className="card">
        <div className="label">Score SDR promedio</div>
        <div
          className="text-3xl font-semibold tracking-tight mt-1"
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
        <div className="text-xs text-ink-muted mt-1">según evaluación de Claude</div>
      </div>
      <div className="card">
        <div className="label">Período</div>
        <div className="text-base font-semibold mt-1">{data.range.label}</div>
        <div className="text-xs text-ink-muted mt-1">
          {formatRange(data.range.start, data.range.end)}
        </div>
      </div>
    </div>
  );
}

function ResponseDistributionCard({
  items
}: {
  items: Array<{ key: string; label: string; count: number }>;
}) {
  const total = items.reduce((s, i) => s + i.count, 0);
  return (
    <div className="card">
      <div className="label mb-3">Respuestas del cliente</div>
      {total === 0 && <div className="text-sm text-ink-muted">Sin datos.</div>}
      <div className="space-y-2">
        {items.map((it) => {
          const pct = total > 0 ? (it.count / total) * 100 : 0;
          return (
            <div key={it.key}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink">{it.label}</span>
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
            </div>
          );
        })}
      </div>
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

function ImprovementsCard({ areas }: { areas: Array<{ area: string; count: number }> }) {
  const max = areas[0]?.count ?? 1;
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
            return (
              <div key={a.area}>
                <div className="flex justify-between text-sm">
                  <span>{a.area}</span>
                  <span className="text-ink-muted">{a.count}×</span>
                </div>
                <div className="h-2 mt-1 bg-canvas rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#854F0B" }} />
                </div>
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

function formatRange(start: string, end: string): string {
  const s = new Date(start).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  const e = new Date(end).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
  return `${s} → ${e}`;
}

function responseColor(cat: string): string {
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
