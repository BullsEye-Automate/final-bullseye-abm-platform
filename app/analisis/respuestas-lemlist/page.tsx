"use client";

// Respuestas Lemlist: bandeja de las respuestas de los prospectos, con su
// clasificación (Claude), el SDR asignado o la alerta al KAM. Las procesa el
// cron /api/cron/respuestas-lemlist cada 15 min (lib/respuestasLemlist/).
import { useEffect, useMemo, useState } from "react";
import { IconMessageReply, IconLoader2, IconAlertCircle, IconRefresh, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";

type Row = {
  id: string; client_name: string | null; campaign_name: string | null; channel: string | null;
  lead_email: string | null; lead_name: string | null; company_name: string | null; reply_text: string | null;
  replied_at: string | null; category: string | null; confidence: number | null; summary: string | null;
  sdr_value: string | null; sdr_name: string | null; kam_email: string | null; action: string | null;
  action_detail: string | null; mode: string | null; hubspot_updated: boolean | null; lemlist_paused: boolean | null;
  error: string | null; created_at: string;
};

const CATEGORY: Record<string, string> = {
  interesado: "Interesado", referido: "Referido", tibio: "Tibio / más adelante", no_interesado: "No interesado",
  fuera_oficina: "Fuera de oficina", baja: "Baja", ambigua: "Ambigua", sin_texto: "Sin texto",
};
const ACTION: Record<string, { label: string; cls: string }> = {
  asignada: { label: "Asignada al SDR", cls: "bg-emerald-100 text-emerald-900" },
  alerta_kam: { label: "Alerta al KAM", cls: "bg-amber-100 text-amber-900" },
  revision_kam: { label: "Revisión KAM", cls: "bg-amber-100 text-amber-900" },
  baja: { label: "Baja", cls: "bg-gray-200 text-gray-800" },
  sin_accion: { label: "Sin acción", cls: "bg-gray-100 text-gray-700" },
  procesando: { label: "Procesando", cls: "bg-sky-100 text-sky-900" },
  error: { label: "Error", cls: "bg-red-100 text-red-900" },
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function ReplyRow({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const a = ACTION[r.action ?? ""] ?? { label: r.action ?? "—", cls: "bg-gray-100 text-gray-700" };
  return (
    <div className={`border-b ${open ? "bg-black/[0.02]" : ""}`}>
      <button onClick={() => setOpen(!open)} className="w-full grid grid-cols-[96px_minmax(0,1.2fr)_minmax(0,1.6fr)_140px_20px] gap-3 items-center py-2.5 px-2 text-left hover:bg-black/[0.03]">
        <div className="text-xs text-ink-muted">{fmt(r.replied_at ?? r.created_at)}</div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{r.lead_name || r.lead_email}</div>
          <div className="text-xs text-ink-muted truncate">{r.company_name || "—"} · {r.client_name}</div>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium">{CATEGORY[r.category ?? ""] ?? r.category ?? "—"}</div>
          <div className="text-xs text-ink-muted truncate">{r.summary}</div>
        </div>
        <div>
          <span className={`inline-block text-xs px-2 py-0.5 rounded ${a.cls}`}>{a.label}</span>
          {r.sdr_name && <div className="text-xs text-ink-muted truncate mt-0.5">{r.sdr_name}</div>}
        </div>
        {open ? <IconChevronUp size={16} className="text-ink-muted" /> : <IconChevronDown size={16} className="text-ink-muted" />}
      </button>
      {open && (
        <div className="px-2 pb-3 text-xs text-ink-muted leading-relaxed space-y-1">
          <div>{r.lead_email} · {r.channel === "linkedin" ? "LinkedIn" : "Email"} · Campaña: {r.campaign_name}</div>
          <div>SDR en HubSpot: {r.sdr_value || "—"} · KAM: {r.kam_email || "—"} · Confianza IA: {r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"}</div>
          <div className="text-ink">{r.action_detail}</div>
          {r.mode === "activo" && <div>HubSpot actualizado: {r.hubspot_updated ? "sí" : "no"} · Pausado en Lemlist: {r.lemlist_paused ? "sí" : "no"}</div>}
          {r.error && <div className="text-error-fg">{r.error}</div>}
          <div className="whitespace-pre-wrap p-2 rounded bg-black/[0.03] text-ink">{r.reply_text || "(sin texto)"}</div>
        </div>
      )}
    </div>
  );
}

export default function RespuestasLemlistPage() {
  const { currentClient } = useClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ days: "30" });
      if (currentClient?.id) qs.set("client_id", currentClient.id);
      const res = await fetch(`/api/respuestas-lemlist?${qs}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `Error ${res.status}`);
      setRows(d.rows); setMode(d.mode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [currentClient?.id]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.action ?? ""] = (c[r.action ?? ""] ?? 0) + 1;
    return c;
  }, [rows]);
  const shown = filter ? rows.filter((r) => r.action === filter) : rows;

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label">Reportería</div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <IconMessageReply size={24} className="text-brand" /> Respuestas Lemlist
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Respuestas de los últimos 30 días, clasificadas y asignadas al SDR de la empresa (o alerta al KAM).
            {mode === "sombra" && <span className="ml-1 text-amber-800">Modo sombra: no se escribe en HubSpot, no se pausa en Lemlist ni se avisa a los SDR.</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border hover:bg-black/5 transition disabled:opacity-50">
          {loading ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />} Actualizar
        </button>
      </header>

      {error && (
        <div className="flex items-center gap-2 text-error-fg text-sm p-3 rounded bg-error-bg/20 border border-error-bg">
          <IconAlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter("")} className={`text-xs px-2.5 py-1 rounded-full border ${!filter ? "bg-black/5 font-medium" : ""}`}>Todas ({rows.length})</button>
        {Object.entries(ACTION).filter(([k]) => counts[k]).map(([k, v]) => (
          <button key={k} onClick={() => setFilter(k)} className={`text-xs px-2.5 py-1 rounded-full border ${filter === k ? "bg-black/5 font-medium" : ""}`}>{v.label} ({counts[k]})</button>
        ))}
      </div>

      <section className="card">
        {loading && !rows.length ? (
          <div className="flex items-center gap-2 text-sm text-ink-muted p-4"><IconLoader2 size={16} className="animate-spin" /> Cargando…</div>
        ) : shown.length ? (
          shown.map((r) => <ReplyRow key={r.id} r={r} />)
        ) : (
          <p className="text-sm text-ink-muted p-4">Sin respuestas en este período.</p>
        )}
      </section>
    </div>
  );
}
