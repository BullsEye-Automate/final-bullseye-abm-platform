"use client";

import { useEffect, useState, useCallback } from "react";
import { useClient } from "@/lib/clientContext";
import { IconCalendar, IconChevronDown, IconShare, IconX } from "@tabler/icons-react";
import ResultadosView, { Meeting } from "./ResultadosView";

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

// ── Modal: generar link para compartir con el cliente ─────────────────────────
function CompartirModal({
  clientId,
  clientName,
  desde,
  hasta,
  presetLabel,
  onClose,
}: {
  clientId: string;
  clientName: string;
  desde: string;
  hasta: string;
  presetLabel: string;
  onClose: () => void;
}) {
  const [link, setLink]           = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function generar() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/resultados-compartidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, desde: desde || null, hasta: hasta || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al generar el link");
      setLink(`${window.location.origin}/oportunidades/resultados/compartido/${data.token}`);
    } catch (err: any) {
      setError(err.message ?? "Error al generar el link");
    } finally {
      setGenerating(false);
    }
  }

  function copiar() {
    if (!link) return;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Compartir con Cliente</h2>
          <button onClick={onClose}><IconX size={18} className="text-gray-400" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-sm text-gray-600">
            <p><span className="font-medium text-gray-900">Cliente:</span> {clientName}</p>
            <p className="mt-1"><span className="font-medium text-gray-900">Rango de fechas:</span> {presetLabel}</p>
          </div>
          <p className="text-xs text-gray-400">
            El cliente solo verá este dashboard, con este rango de fechas fijo. No podrá ver datos de otros
            clientes ni navegar a otras secciones de la plataforma.
          </p>

          {!link ? (
            <button onClick={generar} disabled={generating}
              className="w-full bg-[#251762] text-white rounded-lg py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {generating ? "Generando…" : "Generar link"}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input readOnly value={link} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600" />
              <button onClick={copiar} className="px-3 py-2 rounded-lg bg-[#62E0D8] text-[#251762] text-xs font-medium shrink-0">
                {copied ? "¡Copiado!" : "Copiar"}
              </button>
            </div>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  );
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
  const [showCompartir, setShowCompartir] = useState(false);

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

  const presetLabel = PRESETS.find(p => p.key === preset)?.label ?? "Todo";
  const canShare = !!currentClient && currentClient.id !== "__all__";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resultados</h1>
          <p className="text-sm text-gray-500 mt-1">Resumen de reuniones y feedback del cliente</p>
        </div>
        {/* Filtro fecha + compartir */}
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
          <button
            onClick={() => canShare && setShowCompartir(true)}
            disabled={!canShare}
            title={canShare ? undefined : "Selecciona un cliente específico para compartir"}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 bg-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <IconShare size={14} className="text-gray-400" />
            Compartir con Cliente
          </button>
        </div>
      </div>

      <ResultadosView meetings={meetings} loading={loading} onMeetingsChanged={load} />

      {/* Modal compartir */}
      {showCompartir && currentClient && (
        <CompartirModal
          clientId={currentClient.id}
          clientName={currentClient.name}
          desde={desde}
          hasta={hasta}
          presetLabel={presetLabel}
          onClose={() => setShowCompartir(false)}
        />
      )}
    </div>
  );
}
