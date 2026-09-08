"use client";

import { useCallback, useEffect, useState } from "react";
import { useClient, ALL_CLIENTS } from "@/lib/clientContext";
import {
  IconChartBar,
  IconBuilding,
  IconUsers,
  IconSend,
  IconPhone,
  IconMail,
  IconLoader2,
  IconRefresh,
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconTrendingDown,
  IconBuildingSkyscraper,
} from "@tabler/icons-react";
import type { LemlistReportData } from "@/app/api/reporteria/lemlist/route";

// ─── Tipos (resumen general) ──────────────────────────────────────────────────

type Stats = {
  empresas:             number;
  contactos:            number;
  contactosAprobados:   number;
  contactosEnLemlist:   number;
  contactosDescartados: number;
  llamadas:             number;
  llamadasConectadas:   number;
  respuestas:           number;
  porCliente:           { name: string; empresas: number; contactos: number; en_lemlist: number }[];
};

type Period = "7d" | "30d" | "90d" | "all";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "7d",  label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "90d", label: "90 días" },
  { value: "all", label: "Todo" },
];

function periodToDates(p: Period): { from?: string; to?: string } {
  if (p === "all") return {};
  const now  = new Date();
  const days = p === "7d" ? 7 : p === "30d" ? 30 : 90;
  const from = new Date(now.getTime() - days * 86400000).toISOString();
  return { from, to: now.toISOString() };
}

// ─── Helpers UI ───────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon, color, total,
}: {
  label: string; value: number; sub?: string;
  icon: React.ReactNode; color?: string; total?: number;
}) {
  const pct = total && total > 0 ? Math.round((value / total) * 100) : null;
  return (
    <div className="card px-5 py-4 flex gap-4 items-start">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: color ? `${color}18` : "rgba(98,224,216,0.12)" }}>
        <span style={{ color: color ?? "#62E0D8" }}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
        <div className="text-3xl font-bold text-ink mt-0.5">{value.toLocaleString()}</div>
        {(sub || pct !== null) && (
          <div className="text-xs text-ink-muted mt-0.5">
            {sub}{pct !== null && ` · ${pct}% del total`}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5">
      <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function RateChip({ value, thresholdGreen, thresholdAmber }: { value: number; thresholdGreen: number; thresholdAmber: number }) {
  const color = value >= thresholdGreen ? { bg: "#DCFCE7", text: "#166534" }
    : value >= thresholdAmber ? { bg: "#FEF3C7", text: "#92400E" }
    : { bg: "#FEE2E2", text: "#991B1B" };
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ background: color.bg, color: color.text }}>
      {value}%
    </span>
  );
}

function activityLabel(type: string) {
  const map: Record<string, string> = {
    emailsReplied:          "Email reply",
    linkedinReplied:        "LinkedIn reply",
    linkedinInviteAccepted: "LI aceptado",
    emailsClicked:          "Email click",
    emailsOpened:           "Email visto",
  };
  return map[type] ?? type;
}

function activityEmoji(type: string) {
  const map: Record<string, string> = {
    emailsReplied:          "📧",
    linkedinReplied:        "💼",
    linkedinInviteAccepted: "💼",
    emailsClicked:          "🔗",
    emailsOpened:           "👁️",
  };
  return map[type] ?? "📌";
}

function activityColor(type: string) {
  const map: Record<string, string> = {
    emailsReplied:          "#22c55e",
    linkedinReplied:        "#62E0D8",
    linkedinInviteAccepted: "#62E0D8",
    emailsClicked:          "#f59e0b",
    emailsOpened:           "#f59e0b",
  };
  return map[type] ?? "#6B6480";
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "hace menos de 1h";
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ayer";
  return `hace ${d} días`;
}

// ─── Gráfico de tendencia semanal ────────────────────────────────────────────

function TrendChart({ data, label, color }: { data: { label: string; replyRate: number }[]; label: string; color: string }) {
  if (!data.length) return null;
  const W = 460, H = 155, PAD_L = 48, PAD_B = 30, PAD_T = 10;
  const maxVal = Math.max(...data.map(d => d.replyRate), 2);
  const yMax = Math.ceil(maxVal / 2) * 2 + 2;
  const xStep = (W - PAD_L) / (data.length - 1 || 1);

  function xOf(i: number) { return PAD_L + i * xStep; }
  function yOf(v: number) { return PAD_T + (1 - v / yMax) * H; }

  const points = data.map((d, i) => `${xOf(i)},${yOf(d.replyRate)}`).join(" ");
  const areaPath = `M${data.map((d, i) => `${xOf(i)},${yOf(d.replyRate)}`).join(" L")} L${xOf(data.length - 1)},${PAD_T + H} L${PAD_L},${PAD_T + H} Z`;

  const ticks = [0, yMax / 2, yMax];

  return (
    <svg viewBox={`0 0 ${W + 10} ${PAD_T + H + PAD_B + 10}`} style={{ width: "100%", overflow: "visible" }}>
      <defs>
        <linearGradient id={`tg-${label}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map(t => (
        <g key={t}>
          <line x1={PAD_L} y1={yOf(t)} x2={W} y2={yOf(t)} stroke="#E8E4F2" strokeWidth="1" />
          <text x={PAD_L - 6} y={yOf(t) + 4} textAnchor="end" fontSize="9" fill="#9D95B8">{t}%</text>
        </g>
      ))}
      <path d={areaPath} fill={`url(#tg-${label})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => d.replyRate > 0 && (
        <circle key={i} cx={xOf(i)} cy={yOf(d.replyRate)} r="2.5" fill={color} />
      ))}
      {/* Highlight last point */}
      <circle cx={xOf(data.length - 1)} cy={yOf(data[data.length - 1].replyRate)} r="4" fill={color} />
      <text x={xOf(data.length - 1) - 4} y={yOf(data[data.length - 1].replyRate) - 7}
        fontSize="9" fontWeight="600" fill={color} textAnchor="middle">
        {data[data.length - 1].replyRate}%
      </text>
      {data.map((d, i) => (
        <text key={i} x={xOf(i)} y={PAD_T + H + 16} textAnchor="middle" fontSize="9" fill="#9D95B8">
          {d.label}
        </text>
      ))}
    </svg>
  );
}

// ─── Tab: Campañas Lemlist ────────────────────────────────────────────────────

function LemlistTab({ currentClient }: { currentClient: { id: string; name: string } | null }) {
  const [data, setData]         = useState<LemlistReportData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [period, setPeriod]     = useState<Period>("30d");

  const isAll = !currentClient || currentClient.id === ALL_CLIENTS.id;

  const load = useCallback(async () => {
    if (!currentClient) return;
    setLoading(true);
    setError(null);
    try {
      const { from } = periodToDates(period);
      const sinceParam = from ? `&since=${encodeURIComponent(from)}` : "";
      const res = await fetch(`/api/reporteria/lemlist?client_id=${currentClient.id}${sinceParam}`);
      const d = await res.json();
      if (!res.ok) {
        console.error("[LemlistTab] API error:", res.status, d);
        setError(`${d.error ?? "Error al cargar datos de Lemlist"} (HTTP ${res.status})`);
      } else {
        console.log("[LemlistTab] datos:", d);
        setData(d);
      }
    } catch (e: any) {
      console.error("[LemlistTab] fetch error:", e);
      setError(e?.message ?? "Error de red");
    }
    setLoading(false);
  }, [currentClient, period]);

  useEffect(() => { load(); }, [load]);

  if (!currentClient) {
    return (
      <div className="card flex items-center justify-center py-16 text-ink-muted text-sm">
        Selecciona un cliente o "Todos los clientes" en el sidebar.
      </div>
    );
  }

  const periodSelector = (
    <div className="flex gap-1 p-1 rounded-lg bg-gray-100 w-fit">
      {PERIOD_OPTIONS.map(opt => (
        <button key={opt.value}
          onClick={() => { setPeriod(opt.value); setData(null); }}
          className="text-xs px-3 py-1 rounded-md font-medium transition"
          style={period === opt.value
            ? { background: "#fff", color: "#251762", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
            : { color: "#6B6480" }}>
          {opt.label}
        </button>
      ))}
    </div>
  );

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">{periodSelector}<span /></div>
        <div className="card flex items-center justify-center py-16 gap-2 text-ink-muted">
          <IconLoader2 size={20} className="animate-spin" />
          <span className="text-sm">Cargando datos de Lemlist…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">{periodSelector}<span /></div>
        <div className="card border-l-4 border-red-400 px-5 py-4 text-red-600 text-sm flex items-center gap-2">
          <IconX size={16} /> {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Calcular alertas
  const avgReplyRate = data.replyRate;
  const alerts = data.perClient.filter(c =>
    c.replyRate < avgReplyRate * 0.6 || c.bounceRate > 4
  );

  return (
    <div className="space-y-4">
      {/* Toolbar: filtro de período + botón actualizar */}
      <div className="flex justify-between items-center gap-3">
        {/* Selector de período */}
        <div className="flex gap-1 p-1 rounded-lg bg-gray-100">
          {PERIOD_OPTIONS.map(opt => (
            <button key={opt.value}
              onClick={() => { setPeriod(opt.value); setData(null); }}
              className="text-xs px-3 py-1 rounded-md font-medium transition"
              style={period === opt.value
                ? { background: "#fff", color: "#251762", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                : { color: "#6B6480" }}>
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {loading && data && (
            <span className="flex items-center gap-1.5 text-xs text-ink-muted">
              <IconLoader2 size={13} className="animate-spin" /> Actualizando…
            </span>
          )}
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-[#E5E2F0] hover:bg-gray-50 transition disabled:opacity-50">
            <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Alertas (solo en modo "todos" o si hay problemas) */}
      {isAll && alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map(a => (
            <div key={a.clientId}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm font-medium"
              style={{ background: "rgba(239,68,68,0.05)", borderColor: "rgba(239,68,68,0.25)", color: "#dc2626" }}>
              <IconAlertTriangle size={15} className="shrink-0" />
              <span>
                <strong>{a.clientName}</strong> ({a.campaignName}): reply rate {a.replyRate}%
                {a.bounceRate > 4 && ` · rebote alto ${a.bounceRate}%`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* KPIs */}
      <div className={`grid gap-3 ${isAll ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 lg:grid-cols-4"}`}>
        <div className="card px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Enviados</div>
          <div className="text-3xl font-bold text-ink">{data.totalSent.toLocaleString()}</div>
        </div>
        <div className="card px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Apertura</div>
          <div className="text-3xl font-bold" style={{ color: data.openRate >= 30 ? "#22c55e" : "#f59e0b" }}>
            {data.openRate}%
          </div>
          <div className="text-xs text-ink-muted">{data.totalOpened.toLocaleString()} abiertos</div>
        </div>
        <div className="card px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Reply rate</div>
          <div className="text-3xl font-bold" style={{ color: data.replyRate >= 5 ? "#22c55e" : data.replyRate >= 3 ? "#f59e0b" : "#ef4444" }}>
            {data.replyRate}%
          </div>
          <div className="text-xs text-ink-muted">{data.totalReplied} respuestas</div>
        </div>
        <div className="card px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">LinkedIn acept.</div>
          <div className="text-3xl font-bold text-ink">{data.totalLinkedinAccepted.toLocaleString()}</div>
        </div>
        {isAll && (
          <div className="card px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Rebote</div>
            <div className="text-3xl font-bold" style={{ color: data.bounceRate < 3 ? "#22c55e" : "#ef4444" }}>
              {data.bounceRate}%
            </div>
            <div className="text-xs text-ink-muted">{data.totalBounced} rebotes</div>
          </div>
        )}
      </div>

      {/* Funnel + Tabla por cliente (solo modo "todos") */}
      {isAll && data.perClient.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 items-start">
          {/* Funnel global */}
          <div className="card px-5 py-4">
            <div className="text-[13px] font-semibold text-ink mb-4">Funnel global</div>
            <div className="space-y-2">
              {[
                { label: "Enviados",    value: data.totalSent,    color: "rgba(98,224,216,0.35)" },
                { label: "Abiertos",   value: data.totalOpened,  color: "rgba(245,158,11,0.35)" },
                { label: "Respuestas", value: data.totalReplied, color: "rgba(34,197,94,0.35)" },
              ].map(row => (
                <div key={row.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-ink-muted">{row.label}</span>
                    <span className="font-semibold text-ink">{row.value.toLocaleString()}</span>
                  </div>
                  <ProgressBar value={row.value} max={data.totalSent} color={row.color} />
                </div>
              ))}
            </div>
          </div>

          {/* Tabla por cliente */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-[#E5E2F0] text-[13px] font-semibold text-ink">
              Rendimiento por cliente
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E2F0] bg-gray-50/50">
                    <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Cliente</th>
                    <th className="text-center px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Enviados</th>
                    <th className="text-center px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Apertura</th>
                    <th className="text-center px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Reply rate</th>
                    <th className="text-center px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Canal replies</th>
                    <th className="text-center px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perClient.map(cl => {
                    const hasAlert = cl.replyRate < avgReplyRate * 0.6 || cl.bounceRate > 4;
                    return (
                      <tr key={cl.clientId} className="border-b border-[#F0EEF8] last:border-0 hover:bg-gray-50/50 transition">
                        <td className="px-5 py-2.5">
                          <div className="font-semibold text-ink text-sm">{cl.clientName}</div>
                          <div className="text-[11px] text-ink-muted">{cl.campaignName}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center text-ink-muted">{cl.sent.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-center">
                          <RateChip value={cl.openRate} thresholdGreen={35} thresholdAmber={25} />
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <RateChip value={cl.replyRate} thresholdGreen={5} thresholdAmber={3} />
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex gap-1 justify-center">
                            {cl.emailReplied > 0 && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                style={{ background: "rgba(98,224,216,0.15)", color: "#0d9488" }}>
                                Email {cl.emailReplied}
                              </span>
                            )}
                            {cl.linkedinReplied > 0 && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                style={{ background: "rgba(37,23,98,0.10)", color: "#251762" }}>
                                LI {cl.linkedinReplied}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-2.5 text-center">
                          {hasAlert
                            ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ background: "#FEE2E2", color: "#991B1B" }}>⚠ Revisar</span>
                            : <span className="text-green-600 text-sm">✓</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Funnel (modo cliente individual) */}
      {!isAll && (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 items-start">
          <div className="card px-5 py-4">
            <div className="text-[13px] font-semibold text-ink mb-1">
              {data.campaignName ?? "Campaña"}
            </div>
            <div className="text-xs text-ink-muted mb-4">{data.totalSent} contactos en campaña</div>
            <div className="space-y-2">
              {[
                { label: "Enviados",    value: data.totalSent,    color: "rgba(98,224,216,0.35)" },
                { label: "Abiertos",   value: data.totalOpened,  color: "rgba(245,158,11,0.35)" },
                { label: "Respuestas", value: data.totalReplied, color: "rgba(34,197,94,0.35)" },
              ].map(row => (
                <div key={row.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-ink-muted">{row.label}</span>
                    <span className="font-semibold text-ink">{row.value.toLocaleString()}</span>
                  </div>
                  <ProgressBar value={row.value} max={data.totalSent} color={row.color} />
                </div>
              ))}
            </div>
          </div>
          {/* Desglose email vs LinkedIn */}
          <div className="card px-5 py-4">
            <div className="text-[13px] font-semibold text-ink mb-4">Desglose por canal</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Email replies</div>
                <div className="text-2xl font-bold text-ink">{data.totalEmailReplied}</div>
                <div className="text-xs text-ink-muted mt-0.5">
                  {data.totalSent > 0 ? Math.round(data.totalEmailReplied / data.totalSent * 100) : 0}% de enviados
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">LinkedIn replies</div>
                <div className="text-2xl font-bold text-ink">{data.totalLinkedinReplied}</div>
                <div className="text-xs text-ink-muted mt-0.5">
                  {data.totalLinkedinAccepted > 0
                    ? Math.round(data.totalLinkedinReplied / data.totalLinkedinAccepted * 100) : 0}% de aceptados
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">LI aceptados</div>
                <div className="text-2xl font-bold text-ink">{data.totalLinkedinAccepted}</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Rebotes</div>
                <div className="text-2xl font-bold" style={{ color: data.bounceRate < 3 ? "#22c55e" : "#ef4444" }}>
                  {data.bounceRate}%
                </div>
                <div className="text-xs text-ink-muted mt-0.5">{data.totalBounced} rebotes</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top contactos + Tendencia */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Top contactos */}
        <div className="card px-5 py-4">
          <div className="text-[13px] font-semibold text-ink mb-3">Top contactos por engagement</div>
          {data.topContacts.length === 0 ? (
            <p className="text-sm text-ink-muted">Sin actividad registrada aún.</p>
          ) : (
            <div className="space-y-2">
              {data.topContacts.slice(0, 5).map((c, i) => {
                const initials = `${c.firstName[0] ?? ""}${c.lastName[0] ?? ""}`.toUpperCase();
                return (
                  <div key={i} className="flex items-center gap-3 py-1.5 border-b border-[#F0EEF8] last:border-0">
                    <span className="text-[11px] font-bold text-ink-muted w-5">{`#${i + 1}`}</span>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ background: "rgba(98,224,216,0.12)", color: "#62E0D8" }}>
                      {initials || "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink truncate">{c.firstName} {c.lastName}</div>
                      <div className="text-[11px] text-ink-muted truncate">
                        {c.companyName}
                        {"clientName" in c && (c as any).clientName ? ` · ${(c as any).clientName}` : ""}
                      </div>
                    </div>
                    <div className="text-sm font-bold shrink-0" style={{ color: "#62E0D8" }}>{c.score} pts</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Tendencia semanal */}
        <div className="card px-5 py-4">
          <div className="text-[13px] font-semibold text-ink mb-3">Tendencia semanal · reply rate</div>
          <TrendChart data={data.weeklyTrend} label={currentClient.id} color="#62E0D8" />
        </div>
      </div>

      {/* Empresas con engagement */}
      {data.topCompanies.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-[#E5E2F0] flex items-center gap-2">
            <IconBuildingSkyscraper size={15} style={{ color: "#62E0D8" }} />
            <span className="text-[13px] font-semibold text-ink">Empresas con engagement</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E2F0] bg-gray-50/50">
                  <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Empresa</th>
                  <th className="text-center px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Contactos</th>
                  <th className="text-center px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Replies</th>
                  <th className="text-center px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Score</th>
                  <th className="text-center px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Mejor acción</th>
                  <th className="text-center px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Temperatura</th>
                </tr>
              </thead>
              <tbody>
                {data.topCompanies.map((co, i) => {
                  const heat = co.temperature === "hot"
                    ? { bg: "#DCFCE7", text: "#166534", label: "🔥 Caliente" }
                    : co.temperature === "warm"
                    ? { bg: "#FEF3C7", text: "#92400E", label: "⚡ Tibia" }
                    : { bg: "#F3F4F6", text: "#6B7280", label: "— Fría" };
                  return (
                    <tr key={i} className="border-b border-[#F0EEF8] last:border-0 hover:bg-gray-50/50 transition">
                      <td className="px-5 py-2.5 font-semibold text-ink">{co.companyName}</td>
                      <td className="px-3 py-2.5 text-center text-ink-muted">{co.contactCount}</td>
                      <td className="px-3 py-2.5 text-center font-semibold"
                        style={{ color: co.replyCount > 0 ? "#22c55e" : "#6B7280" }}>
                        {co.replyCount}
                      </td>
                      <td className="px-3 py-2.5 text-center font-semibold text-ink">{co.totalScore}</td>
                      <td className="px-3 py-2.5 text-center text-[11px] text-ink-muted">{co.bestAction || "—"}</td>
                      <td className="px-5 py-2.5 text-center">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: heat.bg, color: heat.text }}>
                          {heat.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actividad reciente */}
      {data.recentActivity.length > 0 && (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted pt-2">
            Actividad reciente · respuestas y engagement
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {data.recentActivity.map((act, i) => (
              <div key={i} className="card flex gap-3 px-4 py-3 items-start">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 mt-0.5"
                  style={{ background: `${activityColor(act.type)}18` }}>
                  {activityEmoji(act.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-ink">{act.firstName} {act.lastName}</div>
                  <div className="text-[11px] text-ink-muted mb-1">
                    {act.companyName}{act.clientName && !isAll ? "" : act.clientName ? ` · ${act.clientName}` : ""}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: activityColor(act.type) }}>
                      {activityLabel(act.type)}
                    </span>
                    <span className="text-[10px] text-ink-muted">{timeAgo(act.at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Resumen general ─────────────────────────────────────────────────────

function ResumenTab({
  currentClient, isAll, stats, loading, error,
}: {
  currentClient: { id: string; name: string } | null;
  isAll: boolean;
  stats: Stats | null;
  loading: boolean;
  error: string | null;
}) {
  const convRate = stats && stats.llamadas > 0
    ? Math.round((stats.llamadasConectadas / stats.llamadas) * 100)
    : null;

  if (!currentClient) {
    return (
      <div className="card flex items-center justify-center py-16 text-ink-muted text-sm">
        Selecciona un cliente o "Todos los clientes" en el sidebar.
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-l-4 border-red-400 px-5 py-4 text-red-600 text-sm flex items-center gap-2">
        <IconX size={16} /> Error: {error}
      </div>
    );
  }

  if (loading && !stats) {
    return (
      <div className="card flex items-center justify-center py-16 gap-2 text-ink-muted">
        <IconLoader2 size={20} className="animate-spin" />
        <span className="text-sm">Cargando datos…</span>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Empresas"   value={stats.empresas}           icon={<IconBuilding size={20} />} color="#62E0D8" />
        <KpiCard label="Contactos"  value={stats.contactos}          icon={<IconUsers size={20} />}   color="#7C3AED" />
        <KpiCard label="En Lemlist" value={stats.contactosEnLemlist} total={stats.contactos}
          icon={<IconSend size={20} />} color="#0EA5E9" />
        <KpiCard label="Respuestas" value={stats.respuestas}         total={stats.contactosEnLemlist}
          icon={<IconMail size={20} />} color="#10B981" />
      </div>

      <div className="card px-5 py-5 space-y-4">
        <h2 className="font-semibold text-ink text-sm">Pipeline de contactos</h2>
        <div className="space-y-3">
          {[
            { label: "Total en base",       value: stats.contactos,          color: "#251762" },
            { label: "Aprobados (fit)",      value: stats.contactosAprobados, color: "#7C3AED" },
            { label: "Enviados a Lemlist",   value: stats.contactosEnLemlist, color: "#0EA5E9" },
            { label: "Respuestas recibidas", value: stats.respuestas,         color: "#10B981" },
          ].map(row => (
            <div key={row.label} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-muted">{row.label}</span>
                <span className="font-semibold text-ink">{row.value.toLocaleString()}</span>
              </div>
              <ProgressBar value={row.value} max={stats.contactos} color={row.color} />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="card px-5 py-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Total llamadas</div>
          <div className="text-3xl font-bold text-ink">{stats.llamadas.toLocaleString()}</div>
        </div>
        <div className="card px-5 py-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Conectadas</div>
          <div className="text-3xl font-bold" style={{ color: "#10B981" }}>{stats.llamadasConectadas.toLocaleString()}</div>
        </div>
        <div className="card px-5 py-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Tasa de conexión</div>
          <div className="text-3xl font-bold"
            style={{ color: convRate && convRate > 20 ? "#10B981" : "#F59E0B" }}>
            {convRate !== null ? `${convRate}%` : "—"}
          </div>
        </div>
      </div>

      {isAll && stats.porCliente.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E5E2F0]">
            <h2 className="font-semibold text-ink text-sm">Desglose por cliente</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E2F0] bg-gray-50/50">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Cliente</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Empresas</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Contactos</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">En Lemlist</th>
                  <th className="text-right px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">% enviado</th>
                </tr>
              </thead>
              <tbody>
                {stats.porCliente.map(cl => {
                  const pct = cl.contactos > 0 ? Math.round((cl.en_lemlist / cl.contactos) * 100) : 0;
                  return (
                    <tr key={cl.name} className="border-b border-[#F0EEF8] last:border-0 hover:bg-gray-50/50 transition">
                      <td className="px-5 py-3 font-medium text-ink">{cl.name}</td>
                      <td className="px-4 py-3 text-right text-ink-muted">{cl.empresas.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-ink-muted">{cl.contactos.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-ink-muted">{cl.en_lemlist.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={pct >= 50
                            ? { background: "#DCFCE7", color: "#166534" }
                            : pct > 0
                            ? { background: "#FEF3C7", color: "#92400E" }
                            : { background: "#F3F4F6", color: "#6B7280" }}>
                          {pct}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t border-[#E5E2F0]">
                  <td className="px-5 py-3 font-semibold text-ink text-sm">Total</td>
                  <td className="px-4 py-3 text-right font-semibold text-ink">{stats.empresas.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-semibold text-ink">{stats.contactos.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-semibold text-ink">{stats.contactosEnLemlist.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <span className="text-xs font-semibold text-ink-muted">
                      {stats.contactos > 0 ? Math.round((stats.contactosEnLemlist / stats.contactos) * 100) : 0}%
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

type Tab = "resumen" | "lemlist";

export default function ReporteriaPage() {
  const { currentClient } = useClient();
  const [activeTab, setActiveTab] = useState<Tab>("resumen");
  const [period, setPeriod]       = useState<Period>("all");
  const [stats, setStats]         = useState<Stats | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const isAll = !currentClient || currentClient.id === ALL_CLIENTS.id;

  const loadResumen = useCallback(async () => {
    if (!currentClient) return;
    setLoading(true);
    setError(null);
    const { from, to } = periodToDates(period);
    const params = new URLSearchParams({ client_id: currentClient.id });
    if (from) params.set("from", from);
    if (to)   params.set("to",   to);
    try {
      const res = await fetch(`/api/reporteria?${params}`);
      const d = await res.json();
      if (!res.ok) setError(d.error ?? "Error al cargar datos");
      else setStats(d);
    } catch (e: any) {
      setError(e?.message ?? "Error de red");
    }
    setLoading(false);
  }, [currentClient, period]);

  useEffect(() => {
    if (activeTab === "resumen") loadResumen();
  }, [activeTab, loadResumen]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label">Análisis</div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconChartBar size={22} style={{ color: "#62E0D8" }} /> Reportería
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            {isAll ? "Resumen consolidado de todos los clientes" : `Resultados de ${currentClient?.name}`}
          </p>
        </div>
        {activeTab === "resumen" && (
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <div className="flex gap-1 bg-white border border-[#E5E2F0] rounded-lg p-0.5">
              {PERIOD_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => setPeriod(opt.value)}
                  className="text-xs px-3 py-1.5 rounded-md transition"
                  style={period === opt.value
                    ? { background: "#251762", color: "white" }
                    : { color: "#6B6884" }}>
                  {opt.label}
                </button>
              ))}
            </div>
            <button onClick={loadResumen} disabled={loading}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-[#E5E2F0] hover:bg-gray-50 transition">
              <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
              Actualizar
            </button>
          </div>
        )}
      </header>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#E5E2F0]">
        {([
          { id: "resumen" as Tab,  label: "Resumen general" },
          { id: "lemlist" as Tab,  label: "Campañas Lemlist" },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className="px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition"
            style={activeTab === t.id
              ? { color: "#62E0D8", borderColor: "#62E0D8" }
              : { color: "#6B6480", borderColor: "transparent" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido */}
      {activeTab === "resumen" ? (
        <ResumenTab
          currentClient={currentClient}
          isAll={isAll}
          stats={stats}
          loading={loading}
          error={error}
        />
      ) : (
        <LemlistTab currentClient={currentClient} />
      )}
    </div>
  );
}
