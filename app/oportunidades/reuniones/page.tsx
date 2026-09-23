"use client";

import { useEffect, useState, useCallback } from "react";
import { useClient } from "@/lib/clientContext";
import { IconCalendar, IconChevronDown, IconX, IconRefresh, IconLoader2 } from "@tabler/icons-react";
import { toChileParts } from "@/lib/timezone";
import MesEnCurso from "./components/MesEnCurso";
import GraficoEvolucion from "./components/GraficoEvolucion";
import GraficoPais from "./components/GraficoPais";
import GraficoIndustria from "./components/GraficoIndustria";
import GraficoOrigen from "./components/GraficoOrigen";
import GraficoHorariosYDias from "./components/GraficoHorariosYDias";

export interface Meeting {
  id: string;
  client_id: string;
  empresa: string;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  fecha_reunion: string | null;
  hora?: string | null;
  realizado: "Si" | "No" | "Pendiente" | "Reagendar";
  pais?: string | null;
  industria?: string | null;
  origen?: string | null;
  hora_formulario?: string | null;
  sdr_nombre?: string | null;
  notas?: string | null;
}

// ── Helpers de fecha (idénticos a feedback page) ──────────────────────────────
function getDateRange(preset: string): { desde: string; hasta: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startOfWeek = (d: Date) => {
    const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  };
  switch (preset) {
    case "hoy":
      return { desde: fmt(now), hasta: fmt(now) };
    case "semana": {
      const s = startOfWeek(now);
      const e = new Date(s);
      e.setDate(s.getDate() + 4); // Lunes a viernes (4 días después del lunes)
      return { desde: fmt(s), hasta: fmt(e) };
    }
    case "semana_pasada": {
      const s = startOfWeek(now);
      s.setDate(s.getDate() - 7);
      const e = new Date(s);
      e.setDate(s.getDate() + 4); // Lunes a viernes (4 días después del lunes)
      return { desde: fmt(s), hasta: fmt(e) };
    }
    case "mes":
      return {
        desde: fmt(new Date(now.getFullYear(), now.getMonth(), 1)),
        hasta: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    case "mes_pasado":
      return {
        desde: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        hasta: fmt(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case "trimestre": {
      const q = Math.floor(now.getMonth() / 3);
      return {
        desde: fmt(new Date(now.getFullYear(), q * 3, 1)),
        hasta: fmt(new Date(now.getFullYear(), q * 3 + 3, 0)),
      };
    }
    case "trimestre_pasado": {
      const q = Math.floor(now.getMonth() / 3);
      return {
        desde: fmt(new Date(now.getFullYear(), (q - 1) * 3, 1)),
        hasta: fmt(new Date(now.getFullYear(), q * 3, 0)),
      };
    }
    case "año":
      return {
        desde: fmt(new Date(now.getFullYear(), 0, 1)),
        hasta: fmt(new Date(now.getFullYear(), 11, 31)),
      };
    default:
      return { desde: "", hasta: "" };
  }
}

const PRESETS = [
  { key: "todo", label: "Todo" },
  { key: "hoy", label: "Hoy" },
  { key: "semana", label: "Esta semana" },
  { key: "semana_pasada", label: "Semana pasada" },
  { key: "mes", label: "Este mes" },
  { key: "mes_pasado", label: "Mes pasado" },
  { key: "trimestre", label: "Este trimestre" },
  { key: "trimestre_pasado", label: "Trimestre pasado" },
  { key: "año", label: "Este año" },
  { key: "personalizado", label: "Personalizado" },
];

// Días transcurridos del mes en curso en hora de Chile (día 1 = 1, día 23 =
// 23, etc.), con un margen de +1 día para no depender de que el instante
// "ahora" del servidor (UTC) y el día calendario de Chile coincidan
// exactamente en el borde de medianoche — de sobra para acotar el sync a
// "este mes" sin arriesgarse a dejar fuera el 1° del mes.
function diasDesdeInicioDeMesChile(): number {
  return toChileParts(new Date()).getUTCDate() + 1;
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function ReunionesPage() {
  const { currentClient, loading: clientLoading } = useClient();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [preset, setPreset] = useState("mes");
  const [presetOpen, setPresetOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (clientLoading) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (currentClient?.id && currentClient.id !== "__all__")
      params.set("client_id", currentClient.id);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    const res = await fetch(`/api/meetings?${params}`);
    const data = await res.json();
    setMeetings(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [currentClient?.id, clientLoading, desde, hasta]);

  // Trae la última versión del Google Sheet, acotado a los días transcurridos
  // del mes en curso (no los 40 días completos que usa el botón global de
  // Análisis SDR) — responde más rápido para el caso de uso de esta página:
  // revisar si "Mes en Curso" ya refleja los cambios recientes del Sheet.
  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const days = diasDesdeInicioDeMesChile();
      const res = await fetch(`/api/meetings/sync?days=${days}`);
      const data = await res.json();
      if (data.error) {
        setSyncMessage(`Error al actualizar: ${data.error}`);
      } else {
        setSyncMessage(`✓ Actualizado — ${data.synced ?? 0} reuniones sincronizadas`);
        await load();
      }
    } catch (err) {
      setSyncMessage(`Error al actualizar: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  // Aplicar preset de fecha
  function applyPreset(key: string) {
    setPreset(key);
    setPresetOpen(false);
    if (key === "personalizado" || key === "todo") {
      setDesde("");
      setHasta("");
    } else {
      const r = getDateRange(key);
      setDesde(r.desde);
      setHasta(r.hasta);
    }
  }

  const presetLabel = PRESETS.find((p) => p.key === preset)?.label ?? "Todo";

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reuniones Agendadas</h1>
          <p className="text-sm text-gray-500 mt-1">
            {currentClient?.id === "__all__" || !currentClient
              ? "Resumen de todas las reuniones agendadas"
              : `Reuniones agendadas para ${currentClient?.name || "cliente"}`}
          </p>
        </div>

        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex flex-col items-end gap-1.5">
            <button
              onClick={handleSync}
              disabled={syncing}
              title="Trae los últimos cambios del Google Sheet, acotado al mes en curso — más rápido que el sync completo"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 bg-white disabled:opacity-50"
            >
              {syncing ? (
                <IconLoader2 size={14} className="animate-spin text-gray-400" />
              ) : (
                <IconRefresh size={14} className="text-gray-400" />
              )}
              Actualizar mes en curso
            </button>
            {syncMessage && <p className="text-xs text-gray-500 text-right">{syncMessage}</p>}
          </div>

          {/* Filtro de fecha */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setPresetOpen((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 bg-white"
              >
                <IconCalendar size={14} className="text-gray-400" />
                {presetLabel}
                <IconChevronDown size={13} className="text-gray-400" />
              </button>
              {presetOpen && (
                <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 min-w-[180px]">
                  {PRESETS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => applyPreset(p.key)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                        preset === p.key ? "text-purple-700 font-medium" : "text-gray-700"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {preset === "personalizado" && (
              <>
                <input
                  type="date"
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none"
                />
                <span className="text-gray-400 text-sm">→</span>
                <input
                  type="date"
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none"
                />
              </>
            )}
            {preset !== "todo" && (
              <button
                onClick={() => applyPreset("todo")}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                Limpiar
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Sección: Mes en Curso */}
          <MesEnCurso meetings={meetings} />

          {/* Gráficos */}
          <div className="grid grid-cols-1 gap-6">
            <GraficoEvolucion meetings={meetings} dateFrom={desde} dateTo={hasta} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <GraficoPais meetings={meetings} />
            <GraficoIndustria meetings={meetings} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <GraficoOrigen meetings={meetings} />
            <GraficoHorariosYDias meetings={meetings} />
          </div>
        </div>
      )}
    </div>
  );
}
