"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconCalendar, IconCheck, IconClock, IconLink, IconPlus,
  IconUpload, IconX, IconMessageCheck, IconAlertCircle, IconRefresh,
  IconChevronDown, IconStar, IconMessage2, IconSearch
} from "@tabler/icons-react";

type Meeting = {
  id: string;
  client_id: string;
  empresa: string;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  fecha_reunion: string | null;
  realizado: "Si" | "No" | "Pendiente" | "Reagendar";
  feedback_status: "pendiente" | "con_feedback";
  feedback_token: string;
  notas: string | null;
  sdr_nombre: string | null;
  meeting_feedback: any[];
};

const REALIZADO_COLORS: Record<string, string> = {
  Si:        "#22c55e",
  No:        "#ef4444",
  Pendiente: "#f59e0b",
  Reagendar: "#8b5cf6",
};

const RAZONES_CONTACTO = [
  "No tomaba decisiones",
  "No presentó interés",
  "No tenía contexto de nosotros",
  "Tomó la reunión desde el celular",
  "Otro",
];
const RAZONES_EMPRESA = [
  "No es de industria objetivo",
  "No es del tamaño objetivo",
  "No es del país objetivo",
  "Otra",
];
const PROPUESTAS = ["Si", "No", "No aún", "Falta otra reunión"];

// ── Helpers de fecha ─────────────────────────────────────────────────────────
function getDateRange(preset: string): { desde: string; hasta: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startOfWeek = (d: Date) => {
    const day = d.getDay(); // 0=dom
    const diff = (day === 0 ? -6 : 1 - day);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  };
  switch (preset) {
    case "hoy": return { desde: fmt(now), hasta: fmt(now) };
    case "semana": {
      const s = startOfWeek(now);
      const e = new Date(s); e.setDate(s.getDate() + 6);
      return { desde: fmt(s), hasta: fmt(e) };
    }
    case "semana_pasada": {
      const s = startOfWeek(now); s.setDate(s.getDate() - 7);
      const e = new Date(s); e.setDate(s.getDate() + 6);
      return { desde: fmt(s), hasta: fmt(e) };
    }
    case "mes": return {
      desde: fmt(new Date(now.getFullYear(), now.getMonth(), 1)),
      hasta: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };
    case "mes_pasado": return {
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
    case "año": return {
      desde: fmt(new Date(now.getFullYear(), 0, 1)),
      hasta: fmt(new Date(now.getFullYear(), 11, 31)),
    };
    default: return { desde: "", hasta: "" };
  }
}

const PRESETS = [
  { key: "todo",          label: "Todo" },
  { key: "hoy",          label: "Hoy" },
  { key: "semana",       label: "Esta semana" },
  { key: "semana_pasada",label: "Semana pasada" },
  { key: "mes",          label: "Este mes" },
  { key: "mes_pasado",   label: "Mes pasado" },
  { key: "trimestre",    label: "Este trimestre" },
  { key: "año",          label: "Este año" },
  { key: "personalizado",label: "Personalizado" },
];

const STATUS_OPTS = ["Todos", "Si", "No", "Pendiente", "Reagendar"];

// ── Modal nueva reunión ───────────────────────────────────────────────────────
function NuevaReunionModal({ clientId, onClose, onSaved }: { clientId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    empresa: "", contacto_nombre: "", contacto_cargo: "",
    fecha_reunion: "", realizado: "Pendiente", notas: "", sdr_nombre: ""
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, client_id: clientId }),
    });
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Nueva reunión</h2>
          <button onClick={onClose}><IconX size={18} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Empresa *</label>
              <input required value={form.empresa} onChange={e => setForm(p => ({ ...p, empresa: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8]" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Fecha reunión</label>
              <input type="date" value={form.fecha_reunion} onChange={e => setForm(p => ({ ...p, fecha_reunion: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Nombre contacto</label>
              <input value={form.contacto_nombre} onChange={e => setForm(p => ({ ...p, contacto_nombre: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8]" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Cargo</label>
              <input value={form.contacto_cargo} onChange={e => setForm(p => ({ ...p, contacto_cargo: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Estado reunión</label>
              <select value={form.realizado} onChange={e => setForm(p => ({ ...p, realizado: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8]">
                {["Pendiente", "Si", "No", "Reagendar"].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">SDR</label>
              <input value={form.sdr_nombre} onChange={e => setForm(p => ({ ...p, sdr_nombre: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8]" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Notas</label>
            <textarea value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} rows={2}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#62E0D8] resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg text-white disabled:opacity-50"
              style={{ background: "#251762" }}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal feedback inline ─────────────────────────────────────────────────────
function FeedbackInlineModal({ meeting, onClose, onSaved }: { meeting: Meeting; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    calificacion: null as number | null,
    empresa_calificada: null as boolean | null,
    razon_no_empresa: "",
    razon_no_empresa_otro: "",
    contacto_calificado: null as boolean | null,
    razon_no_califica: "",
    razon_no_califica_otro: "",
    propuesta_comercial: "",
    comentarios_adicionales: "",
    probabilidad_cierre: null as number | null,
  });
  const [probHover, setProbHover] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.calificacion === null) { setError("Por favor califica la reunión"); return; }
    if (form.empresa_calificada === null) { setError("Por favor responde si la empresa era calificada"); return; }
    if (form.contacto_calificado === null) { setError("Por favor responde si el contacto era calificado"); return; }
    if (form.contacto_calificado === false && !form.razon_no_califica) { setError("Por favor indica por qué no calificaba el contacto"); return; }
    if (!form.propuesta_comercial) { setError("Por favor indica el siguiente paso"); return; }
    setSubmitting(true); setError("");
    const res = await fetch(`/api/encuesta/${meeting.feedback_token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSubmitting(false);
    if (res.ok) { onSaved(); onClose(); }
    else {
      const d = await res.json();
      setError(d.error ?? "Error al enviar. Intenta de nuevo.");
    }
  }

  function BoolBtn({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
    return (
      <div className="flex gap-2">
        <button type="button" onClick={() => onChange(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border-2 transition"
          style={{ borderColor: value === true ? "#22c55e" : "#e5e7eb", background: value === true ? "#f0fdf4" : "#fff", color: value === true ? "#16a34a" : "#6b7280" }}>
          <IconCheck size={15} /> Sí
        </button>
        <button type="button" onClick={() => onChange(false)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border-2 transition"
          style={{ borderColor: value === false ? "#ef4444" : "#e5e7eb", background: value === false ? "#fef2f2" : "#fff", color: value === false ? "#dc2626" : "#6b7280" }}>
          <IconX size={15} /> No
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white rounded-t-2xl px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Feedback — {meeting.empresa}</h2>
            <p className="text-xs text-gray-400">{meeting.contacto_nombre} {meeting.fecha_reunion ? `· ${new Date(meeting.fecha_reunion + "T12:00:00").toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}` : ""}</p>
          </div>
          <button onClick={onClose}><IconX size={18} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* P1 */}
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-3">1. ¿Cómo calificarías esta reunión?</p>
            <div className="flex gap-1">
              {Array.from({ length: 10 }, (_, i) => {
                const n = i + 1;
                const filled = (hover ?? form.calificacion ?? 0) >= n;
                return (
                  <button key={n} type="button"
                    onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}
                    onClick={() => setForm(p => ({ ...p, calificacion: n }))}>
                    <IconStar size={24} fill={filled ? "#f59e0b" : "none"} stroke={filled ? "#f59e0b" : "#d1d5db"} />
                  </button>
                );
              })}
              {form.calificacion && <span className="ml-2 text-sm text-gray-500 self-center">{form.calificacion}/10</span>}
            </div>
          </div>
          {/* P2 */}
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-3">2. ¿La empresa prospecto era calificada?</p>
            <BoolBtn value={form.empresa_calificada} onChange={v => setForm(p => ({ ...p, empresa_calificada: v, razon_no_empresa: v ? "" : p.razon_no_empresa }))} />
            {form.empresa_calificada === false && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-500 mb-2">¿Por qué no calificaba la empresa?</p>
                <div className="space-y-1.5">
                  {RAZONES_EMPRESA.map(r => (
                    <button key={r} type="button" onClick={() => setForm(p => ({ ...p, razon_no_empresa: r }))}
                      className="w-full text-left px-3 py-2 rounded-xl text-sm border-2 transition"
                      style={{ borderColor: form.razon_no_empresa === r ? "#251762" : "#e5e7eb", background: form.razon_no_empresa === r ? "rgba(37,23,98,0.05)" : "#fff", color: form.razon_no_empresa === r ? "#251762" : "#374151" }}>
                      {r}
                    </button>
                  ))}
                  {form.razon_no_empresa === "Otra" && (
                    <textarea value={form.razon_no_empresa_otro}
                      onChange={e => setForm(p => ({ ...p, razon_no_empresa_otro: e.target.value }))}
                      placeholder="Describe el motivo…" rows={2}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none resize-none mt-1" />
                  )}
                </div>
              </div>
            )}
          </div>
          {/* P3 */}
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-3">3. ¿El contacto era el decisor correcto?</p>
            <BoolBtn value={form.contacto_calificado} onChange={v => setForm(p => ({ ...p, contacto_calificado: v, razon_no_califica: v ? "" : p.razon_no_califica }))} />
            {form.contacto_calificado === false && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-500 mb-2">¿Por qué no calificaba el contacto?</p>
                <div className="space-y-1.5">
                  {RAZONES_CONTACTO.map(r => (
                    <button key={r} type="button" onClick={() => setForm(p => ({ ...p, razon_no_califica: r }))}
                      className="w-full text-left px-3 py-2 rounded-xl text-sm border-2 transition"
                      style={{ borderColor: form.razon_no_califica === r ? "#251762" : "#e5e7eb", background: form.razon_no_califica === r ? "rgba(37,23,98,0.05)" : "#fff", color: form.razon_no_califica === r ? "#251762" : "#374151" }}>
                      {r}
                    </button>
                  ))}
                  {form.razon_no_califica === "Otro" && (
                    <textarea value={form.razon_no_califica_otro}
                      onChange={e => setForm(p => ({ ...p, razon_no_califica_otro: e.target.value }))}
                      placeholder="Describe el motivo…" rows={2}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none resize-none mt-1" />
                  )}
                </div>
              </div>
            )}
          </div>
          {/* P4 */}
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-3">4. ¿Le enviarás una propuesta comercial a este prospecto?</p>
            <div className="grid grid-cols-2 gap-2">
              {PROPUESTAS.map(p => (
                <button key={p} type="button" onClick={() => setForm(prev => ({ ...prev, propuesta_comercial: p }))}
                  className="px-3 py-2.5 rounded-xl text-sm border-2 transition text-center font-medium"
                  style={{ borderColor: form.propuesta_comercial === p ? "#62E0D8" : "#e5e7eb", background: form.propuesta_comercial === p ? "rgba(98,224,216,0.1)" : "#fff", color: form.propuesta_comercial === p ? "#0f766e" : "#374151" }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          {/* P5 */}
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-2">5. Comentarios adicionales <span className="font-normal text-gray-400">(opcional)</span></p>
            <textarea value={form.comentarios_adicionales}
              onChange={e => setForm(p => ({ ...p, comentarios_adicionales: e.target.value }))}
              placeholder="Puntos de dolor, contexto relevante, próximos pasos acordados…" rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none resize-none" />
          </div>
          {/* P6: Probabilidad de cierre */}
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-1">6. ¿Cuál es la probabilidad de cierre?</p>
            <p className="text-xs text-gray-400 mb-4">Tu estimación intuitiva de que esto termine en negocio</p>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">Baja</span>
              <span className="text-xl font-bold" style={{
                color: form.probabilidad_cierre === null ? "#d1d5db"
                  : form.probabilidad_cierre >= 70 ? "#22c55e"
                  : form.probabilidad_cierre >= 40 ? "#f59e0b" : "#ef4444"
              }}>
                {form.probabilidad_cierre !== null ? `${form.probabilidad_cierre}%` : "—"}
              </span>
              <span className="text-xs text-gray-400">Alta</span>
            </div>
            <input type="range" min={0} max={100} step={5}
              value={form.probabilidad_cierre ?? 50}
              onChange={e => setForm(p => ({ ...p, probabilidad_cierre: Number(e.target.value) }))}
              onMouseDown={() => { if (form.probabilidad_cierre === null) setForm(p => ({ ...p, probabilidad_cierre: 50 })); }}
              onTouchStart={() => { if (form.probabilidad_cierre === null) setForm(p => ({ ...p, probabilidad_cierre: 50 })); }}
              className="w-full h-2 rounded-full outline-none cursor-pointer"
              style={{ accentColor: form.probabilidad_cierre === null ? "#d1d5db" : form.probabilidad_cierre >= 70 ? "#22c55e" : form.probabilidad_cierre >= 40 ? "#f59e0b" : "#ef4444" }} />
            <div className="flex gap-2 mt-3 flex-wrap">
              {[
                { label: "Sin chances", value: 5 }, { label: "Poco probable", value: 20 },
                { label: "Posible", value: 40 }, { label: "Probable", value: 65 }, { label: "Muy probable", value: 85 },
              ].map(chip => {
                const active = form.probabilidad_cierre === chip.value;
                const color = chip.value >= 65 ? "#22c55e" : chip.value >= 40 ? "#f59e0b" : "#ef4444";
                return (
                  <button key={chip.value} type="button" onClick={() => setForm(p => ({ ...p, probabilidad_cierre: chip.value }))}
                    className="px-2.5 py-1 rounded-full text-xs font-medium border-2 transition"
                    style={{ borderColor: active ? color : "#e5e7eb", background: active ? color + "18" : "#fff", color: active ? color : "#6b7280" }}>
                    {chip.label} ({chip.value}%)
                  </button>
                );
              })}
            </div>
          </div>
          {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>}
          <button type="submit" disabled={submitting}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
            style={{ background: "#251762" }}>
            {submitting ? "Enviando…" : "Enviar feedback"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function FeedbackPage() {
  const { currentClient, loading: clientLoading } = useClient();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading]   = useState(true);
  const [desde, setDesde]       = useState("");
  const [hasta, setHasta]       = useState("");
  const [preset, setPreset]     = useState("todo");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [showModal, setShowModal]       = useState(false);
  const [feedbackMeeting, setFeedbackMeeting] = useState<Meeting | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [syncing, setSyncing]     = useState(false);
  const [copied, setCopied]       = useState<string | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const [search, setSearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (clientLoading) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (currentClient?.id && currentClient.id !== "__all__") params.set("client_id", currentClient.id);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    const res = await fetch(`/api/meetings?${params}`);
    const data = await res.json();
    setMeetings(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [currentClient?.id, clientLoading, desde, hasta]);

  useEffect(() => { load(); }, [load]);

  function applyPreset(key: string) {
    setPreset(key);
    setPresetOpen(false);
    if (key === "personalizado" || key === "todo") {
      setDesde(""); setHasta("");
    } else {
      const r = getDateRange(key);
      setDesde(r.desde); setHasta(r.hasta);
    }
  }

  async function handleSync() {
    setSyncing(true); setImportMsg("");
    try {
      const res = await fetch("/api/meetings/sync");
      const data = await res.json();
      if (data.error) setImportMsg(`Error: ${data.error}`);
      else { setImportMsg(`✓ Sync completado — ${data.synced} reuniones sincronizadas desde Google Sheets`); load(); }
    } catch { setImportMsg("Error de conexión al hacer sync"); }
    setSyncing(false);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportMsg("");
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch("/api/meetings/import", { method: "POST", body: fd });
    const data = await res.json();
    setImporting(false);
    if (data.error) setImportMsg(`Error: ${data.error}`);
    else { setImportMsg(`✓ ${data.imported} reuniones importadas`); load(); }
    e.target.value = "";
  }

  function handleCopy(token: string) {
    const url = `${window.location.origin}/encuesta/${token}`;
    navigator.clipboard.writeText(url);
    setCopied(token); setTimeout(() => setCopied(null), 2000);
  }

  // ── Estadísticas ────────────────────────────────────────────────────────────
  const totalSi        = meetings.filter(m => m.realizado === "Si").length;
  const totalReagendar = meetings.filter(m => m.realizado === "Reagendar").length;
  const totalNo        = meetings.filter(m => m.realizado === "No").length;
  const siSinFeedback  = meetings.filter(m => m.realizado === "Si" && m.feedback_status === "pendiente").length;
  const siConFeedback  = meetings.filter(m => m.realizado === "Si" && m.feedback_status === "con_feedback").length;

  // ── Filtrado y orden ─────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const searched = q
    ? meetings.filter(m =>
        m.empresa.toLowerCase().includes(q) ||
        (m.contacto_nombre ?? "").toLowerCase().includes(q) ||
        (m.contacto_cargo ?? "").toLowerCase().includes(q)
      )
    : meetings;
  const filtered = statusFilter === "Todos" ? searched : searched.filter(m => m.realizado === statusFilter);
  const pendientes  = filtered.filter(m => m.realizado === "Si" && m.feedback_status === "pendiente");
  const conFeedback = filtered.filter(m => m.feedback_status === "con_feedback");
  const otras       = filtered.filter(m => m.realizado !== "Si" && m.feedback_status === "pendiente");
  const ordenadas   = [...pendientes, ...otras, ...conFeedback];

  const presetLabel = PRESETS.find(p => p.key === preset)?.label ?? "Todo";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Feedback de reuniones</h1>
          <p className="text-sm text-gray-500 mt-1">Comparte el link de encuesta con tu cliente después de cada reunión realizada</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
            <IconRefresh size={15} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Sincronizando…" : "Sync Google Sheets"}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
            <IconUpload size={15} /> {importing ? "Importando…" : "Importar CSV"}
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-white font-medium"
            style={{ background: "#251762" }}>
            <IconPlus size={15} /> Nueva reunión
          </button>
        </div>
      </div>

      {importMsg && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${importMsg.startsWith("Error") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
          {importMsg}
        </div>
      )}

      {/* Resumen — fila 1: totales por estado */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-900">{meetings.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">Total reuniones</div>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-100 p-4">
          <div className="text-2xl font-bold text-green-700">{totalSi}</div>
          <div className="text-xs text-green-600 mt-0.5">Realizadas</div>
        </div>
        <div className="rounded-xl border p-4" style={{ background: "#f5f3ff", borderColor: "#ede9fe" }}>
          <div className="text-2xl font-bold" style={{ color: "#7c3aed" }}>{totalReagendar}</div>
          <div className="text-xs mt-0.5" style={{ color: "#7c3aed" }}>Reagendar</div>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-100 p-4">
          <div className="text-2xl font-bold text-red-600">{totalNo}</div>
          <div className="text-xs text-red-500 mt-0.5">No realizadas</div>
        </div>
      </div>

      {/* Resumen — fila 2: feedback de las realizadas */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-amber-50 rounded-xl border border-amber-100 p-4 flex items-center gap-3">
          <IconAlertCircle size={20} className="text-amber-500 shrink-0" />
          <div>
            <div className="text-xl font-bold text-amber-700">{siSinFeedback}</div>
            <div className="text-xs text-amber-600">Realizadas sin feedback</div>
          </div>
        </div>
        <div className="bg-teal-50 rounded-xl border border-teal-100 p-4 flex items-center gap-3">
          <IconMessageCheck size={20} className="text-teal-500 shrink-0" />
          <div>
            <div className="text-xl font-bold text-teal-700">{siConFeedback}</div>
            <div className="text-xs text-teal-600">Realizadas con feedback</div>
          </div>
        </div>
      </div>

      {/* Buscador */}
      <div className="relative mb-3">
        <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por empresa o contacto…"
          className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm outline-none focus:border-[#62E0D8] bg-white"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <IconX size={14} />
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {/* Preset de fecha */}
        <div className="relative">
          <button onClick={() => setPresetOpen(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 bg-white">
            <IconCalendar size={14} className="text-gray-400" />
            {presetLabel}
            <IconChevronDown size={13} className="text-gray-400" />
          </button>
          {presetOpen && (
            <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 min-w-[180px]">
              {PRESETS.map(p => (
                <button key={p.key} onClick={() => applyPreset(p.key)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition ${preset === p.key ? "text-purple-700 font-medium" : "text-gray-700"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Fechas manuales (solo en modo personalizado) */}
        {preset === "personalizado" && (
          <>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
            <span className="text-gray-400 text-sm">→</span>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
          </>
        )}

        {/* Filtro por estado */}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
          {STATUS_OPTS.map(o => <option key={o}>{o}</option>)}
        </select>

        {/* Reset */}
        {(preset !== "todo" || statusFilter !== "Todos") && (
          <button onClick={() => { applyPreset("todo"); setStatusFilter("Todos"); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline">
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Cargando reuniones…</div>
      ) : ordenadas.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <IconCalendar size={40} className="mx-auto mb-3 opacity-30" />
          <p>No hay reuniones{statusFilter !== "Todos" ? ` con estado "${statusFilter}"` : ""}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ordenadas.map(m => {
            const esPendiente = m.realizado === "Si" && m.feedback_status === "pendiente";
            const esFeedback  = m.feedback_status === "con_feedback";
            return (
              <div key={m.id}
                className="bg-white rounded-xl border shadow-sm p-4 flex items-center justify-between gap-4"
                style={{ borderColor: esPendiente ? "#fde68a" : esFeedback ? "#bbf7d0" : "#f1f5f9" }}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="shrink-0">
                    {esFeedback
                      ? <IconMessageCheck size={18} style={{ color: "#22c55e" }} />
                      : esPendiente
                        ? <IconAlertCircle size={18} style={{ color: "#f59e0b" }} />
                        : <IconClock size={18} className="text-gray-300" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{m.empresa}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {[m.contacto_nombre, m.contacto_cargo].filter(Boolean).join(" · ")}
                      {m.fecha_reunion && ` · ${new Date(m.fecha_reunion + "T12:00:00").toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })}`}
                      {m.sdr_nombre && ` · SDR: ${m.sdr_nombre}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium text-white"
                    style={{ background: REALIZADO_COLORS[m.realizado] ?? "#94a3b8" }}>
                    {m.realizado}
                  </span>
                  {esFeedback && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">
                      Con feedback
                    </span>
                  )}
                  {m.realizado === "Si" && !esFeedback && (
                    <button onClick={() => setFeedbackMeeting(m)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border border-purple-200 text-purple-700 hover:bg-purple-50 transition">
                      <IconMessage2 size={13} /> Dejar feedback
                    </button>
                  )}
                  {m.realizado === "Si" && (
                    <button onClick={() => handleCopy(m.feedback_token)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border border-gray-200 hover:bg-gray-50 transition">
                      {copied === m.feedback_token ? <IconCheck size={13} className="text-green-500" /> : <IconLink size={13} />}
                      {copied === m.feedback_token ? "Copiado" : "Copiar link"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modales */}
      {showModal && currentClient?.id && currentClient.id !== "__all__" && (
        <NuevaReunionModal clientId={currentClient.id} onClose={() => setShowModal(false)} onSaved={load} />
      )}
      {showModal && (!currentClient?.id || currentClient.id === "__all__") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm text-center">
            <p className="text-gray-700 mb-4">Selecciona un cliente específico para agregar reuniones.</p>
            <button onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 rounded-lg text-sm">Cerrar</button>
          </div>
        </div>
      )}
      {feedbackMeeting && (
        <FeedbackInlineModal
          meeting={feedbackMeeting}
          onClose={() => setFeedbackMeeting(null)}
          onSaved={() => { setFeedbackMeeting(null); load(); }}
        />
      )}

      {/* CSV */}
      <details className="mt-8">
        <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Ver formato CSV para importar</summary>
        <div className="mt-3 p-4 bg-gray-50 rounded-xl text-xs text-gray-600 font-mono">
          <p className="mb-2 font-sans font-medium text-gray-700">Columnas esperadas:</p>
          <p>ID Cliente, Empresa, Contacto Nombre, Contacto Cargo, Fecha Reunion, Realizado, SDR, Notas</p>
          <p className="mt-2 font-sans text-gray-500">• "Realizado" debe ser: Si / No / Pendiente / Reagendar</p>
        </div>
      </details>
    </div>
  );
}
