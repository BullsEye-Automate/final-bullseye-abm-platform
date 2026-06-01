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
  IconCalendar,
  IconCheck,
  IconX,
} from "@tabler/icons-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

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
  { value: "7d",  label: "Últimos 7 días" },
  { value: "30d", label: "Últimos 30 días" },
  { value: "90d", label: "Últimos 90 días" },
  { value: "all", label: "Todo el tiempo" },
];

function periodToDates(p: Period): { from?: string; to?: string } {
  if (p === "all") return {};
  const now  = new Date();
  const days = p === "7d" ? 7 : p === "30d" ? 30 : 90;
  const from = new Date(now.getTime() - days * 86400000).toISOString();
  return { from, to: now.toISOString() };
}

// ─── Componentes ──────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon, color, total,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: React.ReactNode;
  color?: string;
  total?: number;
}) {
  const pct = total && total > 0 ? Math.round((value / total) * 100) : null;
  return (
    <div className="card px-5 py-4 flex gap-4 items-start">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: color ? `${color}18` : "rgba(98,224,216,0.12)" }}
      >
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

// ─── Página principal ─────────────────────────────────────────────────────────

export default function ReporteriaPage() {
  const { currentClient } = useClient();
  const [period, setPeriod] = useState<Period>("all");
  const [stats, setStats]   = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);

  const isAll = !currentClient || currentClient.id === ALL_CLIENTS.id;

  const load = useCallback(async () => {
    if (!currentClient) return;
    setLoading(true);
    const { from, to } = periodToDates(period);
    const params = new URLSearchParams({ client_id: currentClient.id });
    if (from) params.set("from", from);
    if (to)   params.set("to",   to);
    const res = await fetch(`/api/reporteria?${params}`);
    if (res.ok) setStats(await res.json());
    setLoading(false);
  }, [currentClient, period]);

  useEffect(() => { load(); }, [load]);

  const convRate = stats && stats.llamadas > 0
    ? Math.round((stats.llamadasConectadas / stats.llamadas) * 100)
    : null;

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
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {/* Selector de período */}
          <div className="flex gap-1 bg-white border border-[#E5E2F0] rounded-lg p-0.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className="text-xs px-3 py-1.5 rounded-md transition"
                style={period === opt.value
                  ? { background: "#251762", color: "white" }
                  : { color: "#6B6884" }
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-[#E5E2F0] hover:bg-gray-50 transition"
          >
            <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
            Actualizar
          </button>
        </div>
      </header>

      {!currentClient ? (
        <div className="card flex items-center justify-center py-16 text-ink-muted text-sm">
          Selecciona un cliente o "Todos los clientes" en el sidebar.
        </div>
      ) : loading && !stats ? (
        <div className="card flex items-center justify-center py-16 gap-2 text-ink-muted">
          <IconLoader2 size={20} className="animate-spin" />
          <span className="text-sm">Cargando datos…</span>
        </div>
      ) : stats ? (
        <>
          {/* ── KPIs principales ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Empresas" value={stats.empresas} icon={<IconBuilding size={20} />} color="#62E0D8" />
            <KpiCard label="Contactos" value={stats.contactos} icon={<IconUsers size={20} />} color="#7C3AED" />
            <KpiCard label="En Lemlist" value={stats.contactosEnLemlist} total={stats.contactos} icon={<IconSend size={20} />} color="#0EA5E9" />
            <KpiCard label="Respuestas" value={stats.respuestas} total={stats.contactosEnLemlist} icon={<IconMail size={20} />} color="#10B981" />
          </div>

          {/* ── Pipeline de contactos ── */}
          <div className="card px-5 py-5 space-y-4">
            <h2 className="font-semibold text-ink text-sm">Pipeline de contactos</h2>
            <div className="space-y-3">
              {[
                { label: "Total en base",      value: stats.contactos,            color: "#251762" },
                { label: "Aprobados (fit)",     value: stats.contactosAprobados,   color: "#7C3AED" },
                { label: "Enviados a Lemlist",  value: stats.contactosEnLemlist,   color: "#0EA5E9" },
                { label: "Respuestas recibidas",value: stats.respuestas,            color: "#10B981" },
              ].map((row) => (
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

          {/* ── Llamadas ── */}
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
              <div className="text-3xl font-bold" style={{ color: convRate && convRate > 20 ? "#10B981" : "#F59E0B" }}>
                {convRate !== null ? `${convRate}%` : "—"}
              </div>
            </div>
          </div>

          {/* ── Tabla por cliente (solo en modo Todos) ── */}
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
                    {stats.porCliente.map((cl) => {
                      const pct = cl.contactos > 0 ? Math.round((cl.en_lemlist / cl.contactos) * 100) : 0;
                      return (
                        <tr key={cl.name} className="border-b border-[#F0EEF8] last:border-0 hover:bg-gray-50/50 transition">
                          <td className="px-5 py-3 font-medium text-ink">{cl.name}</td>
                          <td className="px-4 py-3 text-right text-ink-muted">{cl.empresas.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-ink-muted">{cl.contactos.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-ink-muted">{cl.en_lemlist.toLocaleString()}</td>
                          <td className="px-5 py-3 text-right">
                            <span
                              className="text-xs font-semibold px-2 py-0.5 rounded-full"
                              style={pct >= 50
                                ? { background: "#DCFCE7", color: "#166534" }
                                : pct > 0
                                ? { background: "#FEF3C7", color: "#92400E" }
                                : { background: "#F3F4F6", color: "#6B7280" }
                              }
                            >
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
        </>
      ) : null}
    </div>
  );
}
