"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClientListItem, FunnelData } from "@/lib/peithoBackend";

// Paso 6 — Panel de control. A diferencia de ReunionesFuturasView/
// ReunionesPasadasView (que filtran en el navegador sobre una lista ya
// traída), acá cada cambio de filtro dispara un nuevo cálculo en el backend
// (GET /panel/funnel vía la ruta proxy) porque son agregaciones (conteos,
// promedios, agrupaciones) — no tiene sentido traer todas las reuniones al
// navegador para sumarlas ahí.

// Rampa ordinal validada (dataviz skill, node scripts/validate_palette.js
// "...#251762" --mode light --ordinal → ALL CHECKS PASS): un solo hue
// (morado de marca), monotone claro→oscuro, en el orden del funnel.
const FUNNEL_COLORS = ["#B7A3E3", "#9678D6", "#7856C4", "#5A3EA8"];
// Mismo hue que el último escalón del funnel — pasa el piso de contraste
// 3:1 contra blanco (7.6:1), a diferencia del turquesa de marca (1.55:1,
// ilegible como relleno de barra).
const SEGMENT_COLOR = "#5A3EA8";

const THRESHOLD_LABEL: Record<number, string> = {
  1: "1 · Muy bajo",
  2: "2 · Bajo",
  3: "3 · Regular",
  4: "4 · Bueno",
  5: "5 · Muy bueno",
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return isoDate(d);
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

function StatCard({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="bg-white rounded-[14px] border border-gray-100 shadow-sm px-[18px] py-4 flex flex-col gap-1">
      <div className="text-[22px] font-bold" style={{ color: "#1C1530" }}>
        {value}
      </div>
      <div className="text-xs text-gray-500">{label}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}

function FunnelChart({ funnel }: { funnel: FunnelData["funnel"] }) {
  const max = funnel[0]?.count || 1;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">Funnel de reuniones</h2>
      <p className="text-xs text-gray-500 mb-5">Cada etapa es un subconjunto de la anterior — filtrado por el rango de fechas de arriba.</p>
      <div className="space-y-3">
        {funnel.map((stage, i) => {
          const prev = i > 0 ? funnel[i - 1].count : null;
          const widthPct = Math.max((stage.count / max) * 100, stage.count > 0 ? 3 : 0);
          return (
            <div key={stage.key}>
              <div className="flex items-baseline justify-between text-xs text-gray-500 mb-1">
                <span className="font-medium text-gray-700">{stage.label}</span>
                <span>
                  <span className="font-semibold text-gray-900">{stage.count}</span>
                  {" · "}
                  {pct(stage.count, max)} del total
                  {prev != null && <span className="text-gray-400"> · {pct(stage.count, prev)} vs. etapa anterior</span>}
                </span>
              </div>
              <div className="h-6 rounded-[4px] bg-gray-50 overflow-hidden">
                <div
                  className="h-6 rounded-[4px]"
                  style={{ width: `${widthPct}%`, background: FUNNEL_COLORS[i] ?? FUNNEL_COLORS[FUNNEL_COLORS.length - 1] }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SegmentRanking({
  title,
  segments,
}: {
  title: string;
  segments: FunnelData["por_cargo"];
}) {
  const max = Math.max(1, ...segments.map((s) => s.tasa));
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">{title}</h2>
      <p className="text-xs text-gray-500 mb-4">
        % de reuniones analizadas con predicción de éxito alta, por grupo (mínimo 3 reuniones por grupo).
      </p>
      {segments.length === 0 ? (
        <p className="text-sm text-gray-400">Todavía no hay suficientes reuniones analizadas para segmentar.</p>
      ) : (
        <div className="space-y-3">
          {segments.map((s) => (
            <div key={s.label}>
              <div className="flex items-baseline justify-between text-xs text-gray-500 mb-1">
                <span className="font-medium text-gray-700">{s.label}</span>
                <span>
                  <span className="font-semibold text-gray-900">{Math.round(s.tasa * 100)}%</span>
                  {" · "}
                  {s.alta_prediccion}/{s.total} reuniones
                  {s.puntaje_promedio != null && (
                    <span className="text-gray-400"> · predicción prom. {s.puntaje_promedio.toFixed(1)}/5</span>
                  )}
                </span>
              </div>
              <div className="h-4 rounded-[4px] bg-gray-50 overflow-hidden">
                <div
                  className="h-4 rounded-[4px]"
                  style={{ width: `${Math.max((s.tasa / max) * 100, s.tasa > 0 ? 3 : 0)}%`, background: SEGMENT_COLOR }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PanelDeControlView({ isAdmin, clients }: { isAdmin: boolean; clients: ClientListItem[] }) {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(isoDate(new Date()));
  const [threshold, setThreshold] = useState(4);
  const [clientId, setClientId] = useState("");
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from, to, threshold: String(threshold) });
    if (isAdmin && clientId) params.set("client_id", clientId);
    fetch(`/api/panel/funnel?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Error");
        return res.json();
      })
      .then((json: FunnelData) => {
        if (active) setData(json);
      })
      .catch(() => {
        if (active) setError("No se pudo calcular el panel de control.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [from, to, threshold, clientId, isAdmin]);

  const kpis = useMemo(() => {
    if (!data) return null;
    const [agendadas, realizadas, analizadas, altaPrediccion] = data.funnel.map((s) => s.count);
    return {
      agendadas,
      asistencia: pct(realizadas, agendadas),
      altaPrediccionRate: pct(altaPrediccion, analizadas),
      desempeno: data.desempeno_vendedor_promedio != null ? data.desempeno_vendedor_promedio.toFixed(1) : "—",
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-100 rounded-[11px] px-3 py-2 bg-white outline-none focus:border-[#62E0D8]"
          />
          <span>—</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-gray-100 rounded-[11px] px-3 py-2 bg-white outline-none focus:border-[#62E0D8]"
          />
        </div>
        <select
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="text-sm border border-gray-100 rounded-[11px] px-3 py-2 bg-white outline-none focus:border-[#62E0D8]"
          title="Umbral de predicción de éxito considerado 'alto'"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              Predicción alta desde: {THRESHOLD_LABEL[n]}
            </option>
          ))}
        </select>
        {isAdmin && (
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="text-sm border border-gray-100 rounded-[11px] px-3 py-2 bg-white outline-none focus:border-[#62E0D8]"
          >
            <option value="">Todos los clientes</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!error && (loading || !data) ? (
        <p className="text-sm text-gray-400">Calculando…</p>
      ) : !error && data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <StatCard value={String(kpis!.agendadas)} label="Reuniones agendadas" sub="en el rango filtrado" />
            <StatCard value={kpis!.asistencia} label="Tasa de asistencia" sub="reuniones realizadas / agendadas" />
            <StatCard
              value={kpis!.altaPrediccionRate}
              label="% con predicción alta"
              sub="de las reuniones ya analizadas"
            />
            <StatCard value={kpis!.desempeno === "—" ? "—" : `${kpis!.desempeno}/10`} label="Desempeño del vendedor" sub="promedio del período" />
          </div>

          <FunnelChart funnel={data.funnel} />

          <div className="grid md:grid-cols-2 gap-5">
            <SegmentRanking title="Por cargo del contacto" segments={data.por_cargo} />
            <SegmentRanking title="Por industria del contacto" segments={data.por_industria} />
          </div>

          <p className="text-xs text-gray-400">
            "Predicción de éxito" es un puntaje de IA (1-5, calculado por Peitho al analizar cada reunión) — no es una
            tasa de conversión real de negocio (eso requeriría conectar el resultado real del deal desde HubSpot, que
            todavía no está integrado). Los grupos con menos de 3 reuniones analizadas no se muestran en los rankings
            para no mostrar tasas basadas en una sola reunión.
          </p>
        </>
      ) : null}
    </div>
  );
}
