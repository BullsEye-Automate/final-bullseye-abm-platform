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

// Distribución de prediccion_exito (1-5) — pedido explícito del usuario
// (09-09-2026): ver comentario del tipo en lib/peithoBackend.ts.
function PrediccionDistribution({ distribucion }: { distribucion: FunnelData["distribucion_prediccion"] }) {
  const total = distribucion.reduce((sum, b) => sum + b.total, 0);
  const max = Math.max(1, ...distribucion.map((b) => b.total));
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">Distribución de predicción de éxito</h2>
      <p className="text-xs text-gray-500 mb-5">
        % de reuniones analizadas ({total}) en cada puntaje de predicción (1 a 5).
      </p>
      {total === 0 ? (
        <p className="text-sm text-gray-400">Todavía no hay reuniones analizadas en este rango.</p>
      ) : (
        <div className="space-y-3">
          {distribucion.map((b) => (
            <div key={b.puntaje}>
              <div className="flex items-baseline justify-between text-xs text-gray-500 mb-1">
                <span className="font-medium text-gray-700">{THRESHOLD_LABEL[b.puntaje]}</span>
                <span>
                  <span className="font-semibold text-gray-900">{Math.round(b.pct * 100)}%</span>
                  {" · "}
                  {b.total} {b.total === 1 ? "reunión" : "reuniones"}
                </span>
              </div>
              <div className="h-5 rounded-[4px] bg-gray-50 overflow-hidden">
                <div
                  className="h-5 rounded-[4px]"
                  style={{
                    width: `${Math.max((b.total / max) * 100, b.total > 0 ? 3 : 0)}%`,
                    background: FUNNEL_COLORS[b.puntaje - 1] ?? FUNNEL_COLORS[FUNNEL_COLORS.length - 1],
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type EjecutivoSortField = "desempeno_promedio" | "prediccion_promedio" | "total";

// Ranking de ejecutivos por desempeño — pedido explícito del usuario
// (09-09-2026): sortable de mayor a menor y viceversa. A diferencia de
// SegmentRanking (orden fijo, viene ya ordenado del backend), acá el usuario
// puede reordenar por cualquiera de las 3 columnas numéricas — se ordena en
// el navegador porque la lista ya viene completa (una fila por ejecutivo, no
// hay paginación que perder).
function EjecutivoRankingTable({ ranking }: { ranking: FunnelData["por_ejecutivo"] }) {
  const [sortField, setSortField] = useState<EjecutivoSortField>("desempeno_promedio");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    return [...ranking].sort((a, b) => {
      const av = a[sortField] ?? -1;
      const bv = b[sortField] ?? -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [ranking, sortField, sortDir]);

  function toggleSort(field: EjecutivoSortField) {
    if (field !== sortField) {
      setSortField(field);
      setSortDir("desc");
      return;
    }
    setSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  function SortableHeader({ field, label }: { field: EjecutivoSortField; label: string }) {
    const active = sortField === field;
    return (
      <button
        onClick={() => toggleSort(field)}
        className="flex items-center gap-1 hover:text-gray-700 ml-auto"
      >
        {label}
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          style={{ transform: active && sortDir === "asc" ? "rotate(180deg)" : undefined, opacity: active ? 1 : 0.5 }}
        >
          <polyline points="7 10 12 15 17 10" />
        </svg>
      </button>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">Ranking de ejecutivos</h2>
      <p className="text-xs text-gray-500 mb-4">
        Por desempeño del vendedor (1-10) — mínimo 3 reuniones analizadas por ejecutivo.
      </p>
      {ranking.length === 0 ? (
        <p className="text-sm text-gray-400">Todavía no hay suficientes reuniones analizadas para rankear ejecutivos.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-3 font-medium">Ejecutivo</th>
                <th className="py-2 px-3 font-medium text-right">
                  <SortableHeader field="total" label="Reuniones" />
                </th>
                <th className="py-2 px-3 font-medium text-right">
                  <SortableHeader field="desempeno_promedio" label="Desempeño" />
                </th>
                <th className="py-2 pl-3 font-medium text-right">
                  <SortableHeader field="prediccion_promedio" label="Predicción" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.label} className="border-b border-gray-50 last:border-0">
                  <td className="py-2.5 pr-3 text-gray-700">{e.label}</td>
                  <td className="py-2.5 px-3 text-right text-gray-500">{e.total}</td>
                  <td className="py-2.5 px-3 text-right font-semibold text-gray-900">
                    {e.desempeno_promedio != null ? `${e.desempeno_promedio.toFixed(1)}/10` : "—"}
                  </td>
                  <td className="py-2.5 pl-3 text-right text-gray-500">
                    {e.prediccion_promedio != null ? `${e.prediccion_promedio.toFixed(1)}/5` : "—"}
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
  const [ejecutivo, setEjecutivo] = useState("");
  const [ejecutivos, setEjecutivos] = useState<string[]>([]);
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtro cascada (09-09-2026, pedido explícito del usuario): la lista de
  // ejecutivos se refetchea cada vez que cambia el cliente elegido, y el
  // ejecutivo seleccionado se resetea (uno de otro cliente ya no aplica acá)
  // — para el rol "client" (clientId siempre ""/fijo del lado del backend)
  // esto corre una sola vez al montar, listando los ejecutivos de su propio
  // cliente.
  useEffect(() => {
    let active = true;
    setEjecutivo("");
    const params = new URLSearchParams();
    if (isAdmin && clientId) params.set("client_id", clientId);
    fetch(`/api/panel/ejecutivos?${params.toString()}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((json: string[]) => {
        if (active) setEjecutivos(json);
      })
      .catch(() => {
        if (active) setEjecutivos([]);
      });
    return () => {
      active = false;
    };
  }, [clientId, isAdmin]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from, to, threshold: String(threshold) });
    if (isAdmin && clientId) params.set("client_id", clientId);
    if (ejecutivo) params.set("ejecutivo", ejecutivo);
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
  }, [from, to, threshold, clientId, ejecutivo, isAdmin]);

  const kpis = useMemo(() => {
    if (!data) return null;
    const [agendadas, realizadas, analizadas, altaPrediccion] = data.funnel.map((s) => s.count);
    return {
      agendadas,
      asistencia: pct(realizadas, agendadas),
      altaPrediccionRate: pct(altaPrediccion, analizadas),
      desempeno: data.desempeno_vendedor_promedio != null ? data.desempeno_vendedor_promedio.toFixed(1) : "—",
      fitEmpresa: data.fit_empresa_promedio != null ? data.fit_empresa_promedio.toFixed(1) : "—",
      fitContacto: data.fit_contacto_promedio != null ? data.fit_contacto_promedio.toFixed(1) : "—",
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
        {/* Cascada: para admin, solo tiene sentido elegir ejecutivo después de
            elegir cliente (ver comentario del useEffect de arriba) — se oculta
            si no hay cliente elegido, para no dejar clickeable un selector
            que mezclaría ejecutivos de todos los clientes. Un rol "client" ya
            tiene su cliente fijo del lado del backend, así que lo ve directo. */}
        {(!isAdmin || clientId) && ejecutivos.length > 0 && (
          <select
            value={ejecutivo}
            onChange={(e) => setEjecutivo(e.target.value)}
            className="text-sm border border-gray-100 rounded-[11px] px-3 py-2 bg-white outline-none focus:border-[#62E0D8]"
          >
            <option value="">Todos los ejecutivos</option>
            {ejecutivos.map((e) => (
              <option key={e} value={e}>
                {e}
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

          {/* Fit Score (10-09-2026) — promedio de qué tan bien calzan los
              prospectos del período contra el ICP real de cada cliente
              (base de conocimiento). Separado del grid de 4 KPIs de arriba
              (no es del mismo tipo: mide fit, no actividad/desempeño), y
              puede venir "—" si ningún cliente del filtro tiene ICP cargado
              todavía — no es un bug, es la falta de ese dato. */}
          <div className="grid grid-cols-2 gap-3.5">
            <StatCard
              value={kpis!.fitEmpresa === "—" ? "—" : `${kpis!.fitEmpresa}/10`}
              label="Fit Score empresa (promedio)"
              sub="qué tan alineados con el ICP"
            />
            <StatCard
              value={kpis!.fitContacto === "—" ? "—" : `${kpis!.fitContacto}/10`}
              label="Fit Score contacto (promedio)"
              sub="qué tan alineados con el ICP"
            />
          </div>

          <FunnelChart funnel={data.funnel} />

          <PrediccionDistribution distribucion={data.distribucion_prediccion} />

          <EjecutivoRankingTable ranking={data.por_ejecutivo} />

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
