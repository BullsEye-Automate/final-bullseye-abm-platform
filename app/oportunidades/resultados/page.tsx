"use client";

import { useEffect, useState } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconCalendar, IconCheck, IconX, IconClock, IconStar,
  IconMessageCheck, IconAlertCircle, IconTrendingUp, IconBuilding, IconUsers
} from "@tabler/icons-react";

type Meeting = {
  id: string;
  empresa: string;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  fecha_reunion: string | null;
  realizado: "Si" | "No" | "Pendiente" | "Reagendar";
  feedback_status: "pendiente" | "con_feedback";
  meeting_feedback: {
    calificacion: number | null;
    empresa_calificada: boolean | null;
    contacto_calificado: boolean | null;
    razon_no_califica: string | null;
    propuesta_comercial: string | null;
    comentarios_adicionales: string | null;
  }[];
};

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
          <div className="w-28 text-xs text-gray-600 text-right shrink-0">{d.label}</div>
          <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
            <div className="h-full rounded-full flex items-center pl-2 text-[10px] text-white font-medium transition-all"
              style={{ width: `${(d.value / max) * 100}%`, background: d.color, minWidth: d.value > 0 ? "2rem" : 0 }}>
              {d.value > 0 ? d.value : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ResultadosPage() {
  const { currentClient } = useClient();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading]   = useState(true);
  const [desde, setDesde]       = useState("");
  const [hasta, setHasta]       = useState("");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (currentClient?.id && currentClient.id !== "all") params.set("client_id", currentClient.id);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    const res  = await fetch(`/api/meetings?${params}`);
    const data = await res.json();
    setMeetings(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentClient, desde, hasta]);

  // Cálculos
  const total       = meetings.length;
  const realizadas  = meetings.filter(m => m.realizado === "Si");
  const noShow      = meetings.filter(m => m.realizado === "No");
  const pendientes  = meetings.filter(m => m.realizado === "Pendiente");
  const reagendar   = meetings.filter(m => m.realizado === "Reagendar");
  const conFb       = meetings.filter(m => m.feedback_status === "con_feedback");
  const feedbacks   = meetings.flatMap(m => m.meeting_feedback ?? []);

  const tasaRealizacion = total > 0 ? Math.round((realizadas.length / total) * 100) : 0;
  const tasaNoShow      = realizadas.length > 0
    ? Math.round((noShow.length / (realizadas.length + noShow.length)) * 100) : 0;

  const calificaciones  = feedbacks.map(f => f.calificacion).filter(Boolean) as number[];
  const calPromedio     = calificaciones.length
    ? (calificaciones.reduce((a, b) => a + b, 0) / calificaciones.length).toFixed(1) : "–";

  const empresasCalificadas  = feedbacks.filter(f => f.empresa_calificada === true).length;
  const contactosCalificados = feedbacks.filter(f => f.contacto_calificado === true).length;
  const pctEmpresa  = feedbacks.length ? Math.round((empresasCalificadas / feedbacks.length) * 100) : 0;
  const pctContacto = feedbacks.length ? Math.round((contactosCalificados / feedbacks.length) * 100) : 0;

  const propuestas: Record<string, number> = {};
  feedbacks.forEach(f => {
    if (f.propuesta_comercial) propuestas[f.propuesta_comercial] = (propuestas[f.propuesta_comercial] ?? 0) + 1;
  });

  const razones: Record<string, number> = {};
  feedbacks.filter(f => f.razon_no_califica).forEach(f => {
    razones[f.razon_no_califica!] = (razones[f.razon_no_califica!] ?? 0) + 1;
  });

  const comentarios = feedbacks
    .filter(f => f.comentarios_adicionales?.trim())
    .slice(-5)
    .reverse();

  const propuestaColors: Record<string, string> = {
    "Si": "#22c55e", "No": "#ef4444", "No aún": "#f59e0b", "Falta otra reunión": "#8b5cf6"
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resultados</h1>
          <p className="text-sm text-gray-500 mt-1">Resumen de reuniones y feedback del cliente</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Desde</label>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm outline-none" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Hasta</label>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm outline-none" />
          </div>
          {(desde || hasta) && (
            <button onClick={() => { setDesde(""); setHasta(""); }} className="text-xs text-gray-400 hover:text-gray-600">Limpiar</button>
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
            <KpiCard label="No shows" value={noShow.length}
              sub={realizadas.length + noShow.length > 0 ? `${tasaNoShow}% de las agendadas` : undefined}
              color="#ef4444" />
            <KpiCard label="Por reagendar" value={reagendar.length} color="#8b5cf6" />
          </div>

          {/* KPIs feedback */}
          <div className="grid grid-cols-4 gap-4">
            <KpiCard label="Con feedback" value={conFb.length}
              sub={total > 0 ? `${Math.round((conFb.length / total) * 100)}% de reuniones` : undefined}
              color="#62E0D8" />
            <KpiCard label="Sin feedback" value={realizadas.length - conFb.length} color="#f59e0b" />
            <KpiCard label="Calificación promedio" value={`${calPromedio}/10`} color="#251762" />
            <KpiCard label="Pendientes" value={pendientes.length} />
          </div>

          {/* Gráficos */}
          <div className="grid grid-cols-2 gap-6">
            {/* Estado reuniones */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Estado de reuniones</h3>
              <BarChart data={[
                { label: "Realizadas", value: realizadas.length, color: "#22c55e" },
                { label: "No show",    value: noShow.length,     color: "#ef4444" },
                { label: "Pendiente",  value: pendientes.length, color: "#f59e0b" },
                { label: "Reagendar",  value: reagendar.length,  color: "#8b5cf6" },
              ]} />
            </div>

            {/* Propuesta comercial */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">¿Próximo paso con prospecto?</h3>
              {Object.keys(propuestas).length === 0 ? (
                <p className="text-xs text-gray-400">Sin datos de feedback aún</p>
              ) : (
                <BarChart data={Object.entries(propuestas).map(([label, value]) => ({
                  label, value, color: propuestaColors[label] ?? "#94a3b8"
                }))} />
              )}
            </div>
          </div>

          {/* Calidad */}
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Calidad de prospectos (según feedback)</h3>
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
            </div>

            {/* Por qué no calificó el contacto */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">¿Por qué no calificó el contacto?</h3>
              {Object.keys(razones).length === 0 ? (
                <p className="text-xs text-gray-400">Sin datos aún</p>
              ) : (
                <BarChart data={Object.entries(razones).map(([label, value]) => ({
                  label, value, color: "#f59e0b"
                }))} />
              )}
            </div>
          </div>

          {/* Calificaciones recientes */}
          {calificaciones.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                Distribución de calificaciones (1–10)
              </h3>
              <div className="flex items-end gap-1 h-20">
                {Array.from({ length: 10 }, (_, i) => {
                  const n = i + 1;
                  const count = calificaciones.filter(c => c === n).length;
                  const pct = calificaciones.length > 0 ? (count / calificaciones.length) * 100 : 0;
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
    </div>
  );
}
