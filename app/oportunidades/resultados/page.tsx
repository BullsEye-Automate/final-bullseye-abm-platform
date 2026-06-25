"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconCalendar, IconBuilding, IconUsers, IconStar,
  IconMessageCheck, IconChevronDown, IconX, IconCheck, IconLoader2
} from "@tabler/icons-react";

type Feedback = {
  id: string;
  calificacion: number | null;
  empresa_calificada: boolean | null;
  contacto_calificado: boolean | null;
  razon_no_califica: string | null;
  propuesta_comercial: string | null;
  comentarios_adicionales: string | null;
  probabilidad_cierre: number | null;
};

type Meeting = {
  id: string;
  empresa: string;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  industria: string | null;
  pais: string | null;
  fecha_reunion: string | null;
  realizado: "Si" | "No" | "Pendiente" | "Reagendar";
  feedback_status: "pendiente" | "con_feedback";
  meeting_feedback: Feedback[];
};

// ── Helpers de fecha (idénticos a feedback page) ──────────────────────────────
function getDateRange(preset: string): { desde: string; hasta: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startOfWeek = (d: Date) => {
    const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  };
  switch (preset) {
    case "hoy": return { desde: fmt(now), hasta: fmt(now) };
    case "semana": { const s = startOfWeek(now); const e = new Date(s); e.setDate(s.getDate() + 6); return { desde: fmt(s), hasta: fmt(e) }; }
    case "semana_pasada": { const s = startOfWeek(now); s.setDate(s.getDate() - 7); const e = new Date(s); e.setDate(s.getDate() + 6); return { desde: fmt(s), hasta: fmt(e) }; }
    case "mes": return { desde: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), hasta: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
    case "mes_pasado": return { desde: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), hasta: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) };
    case "trimestre": { const q = Math.floor(now.getMonth() / 3); return { desde: fmt(new Date(now.getFullYear(), q * 3, 1)), hasta: fmt(new Date(now.getFullYear(), q * 3 + 3, 0)) }; }
    case "año": return { desde: fmt(new Date(now.getFullYear(), 0, 1)), hasta: fmt(new Date(now.getFullYear(), 11, 31)) };
    default: return { desde: "", hasta: "" };
  }
}
const PRESETS = [
  { key: "todo", label: "Todo" }, { key: "hoy", label: "Hoy" },
  { key: "semana", label: "Esta semana" }, { key: "semana_pasada", label: "Semana pasada" },
  { key: "mes", label: "Este mes" }, { key: "mes_pasado", label: "Mes pasado" },
  { key: "trimestre", label: "Este trimestre" }, { key: "año", label: "Este año" },
  { key: "personalizado", label: "Personalizado" },
];

// ── Componentes ───────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="text-2xl font-bold" style={{ color: color ?? "#111827" }}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function BarChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map(d => (
        <div key={d.label} className="flex items-center gap-2">
          <div className="w-28 text-xs text-gray-600 text-right shrink-0 truncate">{d.label}</div>
          <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
            <div className="h-full rounded-full flex items-center pl-2 text-[10px] text-white font-medium"
              style={{ width: `${(d.value / max) * 100}%`, background: d.color, minWidth: d.value > 0 ? "2rem" : 0 }}>
              {d.value > 0 ? d.value : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const PROPUESTA_OPTIONS = ["Si", "No", "No aún", "Falta otra reunión"];
const PROPUESTA_COLORS: Record<string, string> = {
  "Si": "#22c55e", "No": "#ef4444", "No aún": "#f59e0b", "Falta otra reunión": "#8b5cf6"
};
const PROPUESTA_BG: Record<string, string> = {
  "Si": "#f0fdf4", "No": "#fef2f2", "No aún": "#fffbeb", "Falta otra reunión": "#f5f3ff"
};

// ── Modal: empresas por propuesta ─────────────────────────────────────────────
function PropuestaModal({
  propuesta,
  meetings,
  onClose,
  onUpdated,
}: {
  propuesta: string;
  meetings: Meeting[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [updating, setUpdating] = useState<string | null>(null);

  async function changePropuesta(meeting: Meeting, newVal: string) {
    setUpdating(meeting.id);
    await fetch(`/api/meetings/${meeting.id}/propuesta`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propuesta_comercial: newVal }),
    });
    setUpdating(null);
    onUpdated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: PROPUESTA_COLORS[propuesta] }} />
            <h2 className="text-base font-semibold text-gray-900">Propuesta: {propuesta}</h2>
            <span className="text-xs text-gray-400 ml-1">({meetings.length})</span>
          </div>
          <button onClick={onClose}><IconX size={18} className="text-gray-400" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {meetings.map(m => {
            const fb = m.meeting_feedback?.[0];
            return (
              <div key={m.id} className="border border-gray-100 rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{m.empresa}</p>
                    <p className="text-xs text-gray-500">
                      {[m.contacto_nombre, m.contacto_cargo].filter(Boolean).join(" · ")}
                      {m.fecha_reunion && ` · ${new Date(m.fecha_reunion + "T12:00:00").toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}`}
                    </p>
                  </div>
                </div>
                {/* Cambiar estado */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {PROPUESTA_OPTIONS.map(opt => (
                    <button key={opt} onClick={() => changePropuesta(m, opt)} disabled={updating === m.id}
                      className="px-2.5 py-1 rounded-full text-[11px] font-medium border-2 transition flex items-center gap-1"
                      style={{
                        borderColor: fb?.propuesta_comercial === opt ? PROPUESTA_COLORS[opt] : "#e5e7eb",
                        background:  fb?.propuesta_comercial === opt ? PROPUESTA_BG[opt] : "#fff",
                        color:       fb?.propuesta_comercial === opt ? PROPUESTA_COLORS[opt] : "#6b7280",
                      }}>
                      {updating === m.id && fb?.propuesta_comercial === opt
                        ? <IconLoader2 size={10} className="animate-spin" />
                        : fb?.propuesta_comercial === opt ? <IconCheck size={10} /> : null}
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {meetings.length === 0 && <p className="text-sm text-gray-400 text-center py-8">Sin reuniones en este estado</p>}
        </div>
      </div>
    </div>
  );
}

// ── Función de agrupación para insights ───────────────────────────────────────
function groupByAvg(items: { key: string; score: number }[], minCount = 1) {
  const map = new Map<string, number[]>();
  for (const { key, score } of items) {
    if (!key) continue;
    const arr = map.get(key) ?? []; arr.push(score); map.set(key, arr);
  }
  return Array.from(map.entries())
    .filter(([, arr]) => arr.length >= minCount)
    .map(([key, arr]) => ({ key, avg: arr.reduce((a, b) => a + b, 0) / arr.length, count: arr.length }))
    .sort((a, b) => b.avg - a.avg);
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function ResultadosPage() {
  const { currentClient, loading: clientLoading } = useClient();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading]   = useState(true);
  const [desde, setDesde]       = useState("");
  const [hasta, setHasta]       = useState("");
  const [preset, setPreset]     = useState("todo");
  const [presetOpen, setPresetOpen] = useState(false);
  const [propuestaModal, setPropuestaModal] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (clientLoading) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (currentClient?.id && currentClient.id !== "__all__") params.set("client_id", currentClient.id);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    const res  = await fetch(`/api/meetings?${params}`);
    const data = await res.json();
    setMeetings(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [currentClient?.id, clientLoading, desde, hasta]);

  useEffect(() => { load(); }, [load]);

  function applyPreset(key: string) {
    setPreset(key); setPresetOpen(false);
    if (key === "personalizado" || key === "todo") { setDesde(""); setHasta(""); }
    else { const r = getDateRange(key); setDesde(r.desde); setHasta(r.hasta); }
  }

  // ── Cálculos ────────────────────────────────────────────────────────────────
  const total      = meetings.length;
  const realizadas = meetings.filter(m => m.realizado === "Si");
  const noShow     = meetings.filter(m => m.realizado === "No");
  const pendientes = meetings.filter(m => m.realizado === "Pendiente");
  const reagendar  = meetings.filter(m => m.realizado === "Reagendar");
  const conFb      = meetings.filter(m => m.feedback_status === "con_feedback");
  const feedbacks  = meetings.flatMap(m => m.meeting_feedback ?? []);

  const tasaRealizacion = total > 0 ? Math.round((realizadas.length / total) * 100) : 0;
  const tasaNoShow      = total > 0 ? 100 - tasaRealizacion : 0;

  const calificaciones = feedbacks.map(f => f.calificacion).filter(Boolean) as number[];
  const calPromedio    = calificaciones.length
    ? (calificaciones.reduce((a, b) => a + b, 0) / calificaciones.length).toFixed(1) : "–";

  const empresasCalificadas  = feedbacks.filter(f => f.empresa_calificada === true).length;
  const contactosCalificados = feedbacks.filter(f => f.contacto_calificado === true).length;
  const pctEmpresa  = feedbacks.length ? Math.round((empresasCalificadas / feedbacks.length) * 100) : 0;
  const pctContacto = feedbacks.length ? Math.round((contactosCalificados / feedbacks.length) * 100) : 0;

  // Propuestas: reuniones CON feedback agrupadas por propuesta_comercial
  // (se usa conFb en vez de realizadas para evitar que un desync de "realizado" excluya reuniones)
  const propuestaMap = new Map<string, Meeting[]>();
  PROPUESTA_OPTIONS.forEach(k => propuestaMap.set(k, []));
  for (const m of conFb) {
    const fb = m.meeting_feedback?.[0];
    if (fb?.propuesta_comercial && propuestaMap.has(fb.propuesta_comercial)) {
      propuestaMap.get(fb.propuesta_comercial)!.push(m);
    }
  }
  const conPropuesta   = (propuestaMap.get("Si") ?? []).length;
  const pctPropuesta   = conFb.length > 0 ? Math.round((conPropuesta / conFb.length) * 100) : 0;

  const razones: Record<string, number> = {};
  feedbacks.filter(f => f.razon_no_califica).forEach(f => {
    razones[f.razon_no_califica!] = (razones[f.razon_no_califica!] ?? 0) + 1;
  });

  const comentarios = feedbacks.filter(f => f.comentarios_adicionales?.trim()).slice(-5).reverse();

  // ── Probabilidad de cierre ──────────────────────────────────────────────────
  const conProb = conFb.filter(m => m.meeting_feedback?.[0]?.probabilidad_cierre !== null && m.meeting_feedback?.[0]?.probabilidad_cierre !== undefined);
  const probPromedio = conProb.length
    ? Math.round(conProb.reduce((acc, m) => acc + (m.meeting_feedback![0].probabilidad_cierre ?? 0), 0) / conProb.length)
    : null;

  // Reuniones con alta probabilidad (>= 60%)
  const altaProb = conProb
    .filter(m => (m.meeting_feedback![0].probabilidad_cierre ?? 0) >= 60)
    .sort((a, b) => (b.meeting_feedback![0].probabilidad_cierre ?? 0) - (a.meeting_feedback![0].probabilidad_cierre ?? 0));

  // Grupos por dimensión para alta prob
  function groupByProb(items: Meeting[]) {
    return {
      cargo:     groupByAvgProb(items, m => m.contacto_cargo ?? ""),
      industria: groupByAvgProb(items, m => m.industria ?? ""),
      pais:      groupByAvgProb(items, m => m.pais ?? ""),
    };
  }
  function groupByAvgProb(items: Meeting[], keyFn: (m: Meeting) => string) {
    const map = new Map<string, { total: number; count: number }>();
    for (const m of items) {
      const key = keyFn(m);
      if (!key) continue;
      const prob = m.meeting_feedback![0].probabilidad_cierre ?? 0;
      const cur = map.get(key) ?? { total: 0, count: 0 };
      map.set(key, { total: cur.total + prob, count: cur.count + 1 });
    }
    return Array.from(map.entries())
      .map(([key, { total, count }]) => ({ key, avg: total / count, count }))
      .sort((a, b) => b.avg - a.avg);
  }

  const altaProbGroups = groupByProb(altaProb);

  // ── Insights: mejores/peores reuniones ──────────────────────────────────────
  const ratedMeetings = realizadas
    .map(m => ({ m, score: m.meeting_feedback?.[0]?.calificacion ?? null }))
    .filter(({ score }) => score !== null) as { m: Meeting; score: number }[];

  const byCargo     = groupByAvg(ratedMeetings.map(({ m, score }) => ({ key: m.contacto_cargo ?? "", score })));
  const byIndustria = groupByAvg(ratedMeetings.map(({ m, score }) => ({ key: m.industria ?? "", score })));
  const byPais      = groupByAvg(ratedMeetings.map(({ m, score }) => ({ key: m.pais ?? "", score })));

  const topN = 5;
  const top    = { cargo: byCargo.slice(0, topN),     industria: byIndustria.slice(0, topN),     pais: byPais.slice(0, topN) };
  const bottom = { cargo: byCargo.slice(-topN).reverse(), industria: byIndustria.slice(-topN).reverse(), pais: byPais.slice(-topN).reverse() };

  const presetLabel = PRESETS.find(p => p.key === preset)?.label ?? "Todo";

  function RatingRow({ label, avg, count }: { label: string; avg: number; count: number }) {
    const color = avg >= 7 ? "#22c55e" : avg >= 5 ? "#f59e0b" : "#ef4444";
    return (
      <div className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
        <span className="flex-1 text-sm text-gray-700 truncate">{label}</span>
        <span className="text-xs text-gray-400">({count})</span>
        <span className="text-sm font-semibold w-10 text-right" style={{ color }}>{avg.toFixed(1)}</span>
        <div className="w-20 bg-gray-100 rounded-full h-1.5">
          <div className="h-full rounded-full" style={{ width: `${(avg / 10) * 100}%`, background: color }} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resultados</h1>
          <p className="text-sm text-gray-500 mt-1">Resumen de reuniones y feedback del cliente</p>
        </div>
        {/* Filtro fecha */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setPresetOpen(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 bg-white">
              <IconCalendar size={14} className="text-gray-400" />
              {presetLabel}
              <IconChevronDown size={13} className="text-gray-400" />
            </button>
            {presetOpen && (
              <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 min-w-[180px]">
                {PRESETS.map(p => (
                  <button key={p.key} onClick={() => applyPreset(p.key)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${preset === p.key ? "text-purple-700 font-medium" : "text-gray-700"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {preset === "personalizado" && (
            <>
              <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
              <span className="text-gray-400 text-sm">→</span>
              <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
            </>
          )}
          {preset !== "todo" && (
            <button onClick={() => applyPreset("todo")} className="text-xs text-gray-400 hover:text-gray-600 underline">Limpiar</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Cargando resultados…</div>
      ) : total === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <IconCalendar size={40} className="mx-auto mb-3 opacity-30" />
          <p>Sin datos de reuniones aún</p>
          <p className="text-sm mt-1">Importa reuniones desde el módulo de Feedback</p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* KPIs principales */}
          <div className="grid grid-cols-4 gap-4">
            <KpiCard label="Reuniones agendadas" value={total} />
            <KpiCard label="Reuniones realizadas" value={realizadas.length}
              sub={`${tasaRealizacion}% tasa de realización`} color="#22c55e" />
            <KpiCard label="No realizadas" value={total - realizadas.length}
              sub={`${tasaNoShow}% del total agendado`} color="#ef4444" />
            <KpiCard label="Por reagendar" value={reagendar.length} color="#8b5cf6" />
          </div>

          {/* KPIs feedback */}
          <div className="grid grid-cols-4 gap-4">
            <KpiCard label="Con feedback" value={conFb.length}
              sub={realizadas.length > 0 ? `${Math.round((conFb.length / realizadas.length) * 100)}% de realizadas` : undefined}
              color="#62E0D8" />
            <KpiCard label="Sin feedback" value={realizadas.length - conFb.length} color="#f59e0b" />
            <KpiCard label="Calificación promedio" value={`${calPromedio}/10`} color="#251762" />
            <KpiCard label="Pendientes" value={pendientes.length} />
          </div>

          {/* Propuesta comercial — tarjetas clicables */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-700">¿Le enviarás propuesta comercial?</h3>
              <span className="text-xs text-gray-400">
                {conPropuesta} de {conFb.length} con feedback ({pctPropuesta}%) con propuesta enviada
              </span>
            </div>
            <p className="text-xs text-gray-400 mb-4">Haz clic en una tarjeta para ver las empresas y cambiar el estado</p>
            <div className="grid grid-cols-4 gap-3">
              {PROPUESTA_OPTIONS.map(opt => {
                const list = propuestaMap.get(opt) ?? [];
                return (
                  <button key={opt} onClick={() => setPropuestaModal(opt)}
                    className="rounded-xl border-2 p-4 text-left transition hover:shadow-md"
                    style={{ borderColor: PROPUESTA_COLORS[opt], background: PROPUESTA_BG[opt] }}>
                    <div className="text-2xl font-bold" style={{ color: PROPUESTA_COLORS[opt] }}>{list.length}</div>
                    <div className="text-xs font-medium mt-1" style={{ color: PROPUESTA_COLORS[opt] }}>{opt}</div>
                    {conFb.length > 0 && (
                      <div className="text-[10px] mt-0.5" style={{ color: PROPUESTA_COLORS[opt], opacity: 0.7 }}>
                        {Math.round((list.length / conFb.length) * 100)}% con feedback
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Gráficos estado + calidad */}
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Estado de reuniones</h3>
              <BarChart data={[
                { label: "Realizadas", value: realizadas.length, color: "#22c55e" },
                { label: "No realizadas", value: noShow.length,  color: "#ef4444" },
                { label: "Pendiente",  value: pendientes.length, color: "#f59e0b" },
                { label: "Reagendar",  value: reagendar.length,  color: "#8b5cf6" },
              ]} />
            </div>

            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Calidad de prospectos</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span className="flex items-center gap-1"><IconBuilding size={12} /> Empresas calificadas</span>
                    <span className="font-medium">{empresasCalificadas}/{feedbacks.length} ({pctEmpresa}%)</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-3">
                    <div className="h-full rounded-full" style={{ width: `${pctEmpresa}%`, background: "#62E0D8" }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span className="flex items-center gap-1"><IconUsers size={12} /> Contactos calificados</span>
                    <span className="font-medium">{contactosCalificados}/{feedbacks.length} ({pctContacto}%)</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-3">
                    <div className="h-full rounded-full" style={{ width: `${pctContacto}%`, background: "#251762" }} />
                  </div>
                </div>
              </div>

              {Object.keys(razones).length > 0 && (
                <div className="mt-5 pt-4 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-500 mb-3">¿Por qué no calificó el contacto?</p>
                  <BarChart data={Object.entries(razones).map(([label, value]) => ({ label, value, color: "#f59e0b" }))} />
                </div>
              )}
            </div>
          </div>

          {/* Distribución calificaciones */}
          {calificaciones.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Distribución de calificaciones (1–10)</h3>
              <div className="flex items-end gap-1 h-24">
                {Array.from({ length: 10 }, (_, i) => {
                  const n = i + 1;
                  const count = calificaciones.filter(c => c === n).length;
                  const pct = (count / calificaciones.length) * 100;
                  const color = n <= 4 ? "#ef4444" : n <= 6 ? "#f59e0b" : "#22c55e";
                  return (
                    <div key={n} className="flex-1 flex flex-col items-center gap-1">
                      <div className="text-[10px] text-gray-500">{count > 0 ? count : ""}</div>
                      <div className="w-full rounded-t" style={{ height: `${Math.max(pct, 2)}%`, background: color, minHeight: count > 0 ? 4 : 0 }} />
                      <div className="text-[10px] text-gray-400">{n}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Probabilidad de cierre */}
          {conProb.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">Probabilidad de cierre</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Estimación del SDR al momento del feedback</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold" style={{ color: probPromedio !== null && probPromedio >= 60 ? "#22c55e" : probPromedio !== null && probPromedio >= 40 ? "#f59e0b" : "#ef4444" }}>
                    {probPromedio !== null ? `${probPromedio}%` : "—"}
                  </div>
                  <div className="text-xs text-gray-400">promedio</div>
                </div>
              </div>

              {/* Distribución por rangos */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: "Alta (≥60%)", min: 60, color: "#22c55e", bg: "#f0fdf4" },
                  { label: "Media (30–59%)", min: 30, max: 59, color: "#f59e0b", bg: "#fffbeb" },
                  { label: "Baja (<30%)", max: 29, color: "#ef4444", bg: "#fef2f2" },
                ].map(band => {
                  const count = conProb.filter(m => {
                    const p = m.meeting_feedback![0].probabilidad_cierre ?? 0;
                    if (band.min !== undefined && band.max !== undefined) return p >= band.min && p <= band.max;
                    if (band.min !== undefined) return p >= band.min;
                    return p <= (band.max ?? 100);
                  }).length;
                  return (
                    <div key={band.label} className="rounded-xl p-3 text-center" style={{ background: band.bg }}>
                      <div className="text-xl font-bold" style={{ color: band.color }}>{count}</div>
                      <div className="text-[11px] font-medium mt-0.5" style={{ color: band.color }}>{band.label}</div>
                    </div>
                  );
                })}
              </div>

              {/* Lista de alta probabilidad */}
              {altaProb.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Reuniones con alta probabilidad de cierre ({altaProb.length})
                  </p>

                  {/* Listado de empresas */}
                  <div className="space-y-2 mb-5">
                    {altaProb.slice(0, 8).map(m => {
                      const prob = m.meeting_feedback![0].probabilidad_cierre ?? 0;
                      const color = prob >= 80 ? "#22c55e" : prob >= 60 ? "#84cc16" : "#f59e0b";
                      return (
                        <div key={m.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-gray-900 truncate">{m.empresa}</p>
                            <p className="text-xs text-gray-500 truncate">
                              {[m.contacto_nombre, m.contacto_cargo, m.industria, m.pais].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            <div className="w-20 bg-gray-100 rounded-full h-1.5">
                              <div className="h-full rounded-full" style={{ width: `${prob}%`, background: color }} />
                            </div>
                            <span className="text-sm font-bold w-10 text-right" style={{ color }}>{prob}%</span>
                          </div>
                        </div>
                      );
                    })}
                    {altaProb.length > 8 && (
                      <p className="text-xs text-gray-400 text-center pt-1">+{altaProb.length - 8} más…</p>
                    )}
                  </div>

                  {/* Patrones por dimensión */}
                  <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-100">
                    {[
                      { title: "Por cargo", data: altaProbGroups.cargo },
                      { title: "Por industria", data: altaProbGroups.industria },
                      { title: "Por país", data: altaProbGroups.pais },
                    ].map(({ title, data }) => data.length > 0 && (
                      <div key={title}>
                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</p>
                        <div className="space-y-1.5">
                          {data.slice(0, 5).map(({ key, avg, count }) => {
                            const color = avg >= 75 ? "#22c55e" : avg >= 60 ? "#84cc16" : "#f59e0b";
                            return (
                              <div key={key} className="flex items-center gap-1.5">
                                <span className="flex-1 text-xs text-gray-700 truncate">{key}</span>
                                <span className="text-[10px] text-gray-400">({count})</span>
                                <span className="text-xs font-semibold w-9 text-right" style={{ color }}>{Math.round(avg)}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {altaProb.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Aún no hay reuniones con probabilidad ≥60%</p>
              )}
            </div>
          )}

          {/* Insights: mejores y peores reuniones */}
          {ratedMeetings.length > 0 && (
            <div className="grid grid-cols-2 gap-6">
              {/* Mejores */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <IconStar size={16} className="text-yellow-400" />
                  <h3 className="text-sm font-semibold text-gray-700">Reuniones mejor valoradas</h3>
                </div>
                {byCargo.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Por cargo</p>
                    {top.cargo.map(({ key, avg, count }) => <RatingRow key={key} label={key} avg={avg} count={count} />)}
                  </div>
                )}
                {byIndustria.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Por industria</p>
                    {top.industria.map(({ key, avg, count }) => <RatingRow key={key} label={key} avg={avg} count={count} />)}
                  </div>
                )}
                {byPais.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Por país</p>
                    {top.pais.map(({ key, avg, count }) => <RatingRow key={key} label={key} avg={avg} count={count} />)}
                  </div>
                )}
              </div>

              {/* Peores */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <IconStar size={16} className="text-gray-300" />
                  <h3 className="text-sm font-semibold text-gray-700">Reuniones peor valoradas</h3>
                </div>
                {bottom.cargo.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Por cargo</p>
                    {bottom.cargo.map(({ key, avg, count }) => <RatingRow key={key} label={key} avg={avg} count={count} />)}
                  </div>
                )}
                {bottom.industria.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Por industria</p>
                    {bottom.industria.map(({ key, avg, count }) => <RatingRow key={key} label={key} avg={avg} count={count} />)}
                  </div>
                )}
                {bottom.pais.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Por país</p>
                    {bottom.pais.map(({ key, avg, count }) => <RatingRow key={key} label={key} avg={avg} count={count} />)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Comentarios */}
          {comentarios.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Últimos comentarios de feedback</h3>
              <div className="space-y-2">
                {comentarios.map((f, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg px-4 py-2 text-sm text-gray-700 italic">
                    "{f.comentarios_adicionales}"
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal propuesta */}
      {propuestaModal && (
        <PropuestaModal
          propuesta={propuestaModal}
          meetings={propuestaMap.get(propuestaModal) ?? []}
          onClose={() => setPropuestaModal(null)}
          onUpdated={() => { setPropuestaModal(null); load(); }}
        />
      )}
    </div>
  );
}
