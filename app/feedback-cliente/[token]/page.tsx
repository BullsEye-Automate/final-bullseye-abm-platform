"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  IconCheck, IconAlertCircle, IconMessageCheck, IconCalendar,
  IconStar, IconX, IconSearch, IconChevronDown, IconMessage2,
} from "@tabler/icons-react";

type ClientData = {
  id: string;
  name: string;
  logo_url: string | null;
};

type Meeting = {
  id: string;
  empresa: string;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  fecha_reunion: string | null;
  realizado: string;
  feedback_status: "pendiente" | "con_feedback";
  feedback_token: string;
  sdr_nombre: string | null;
};

type FormState = {
  sdr_seleccionado: string;
  calificacion: number | null;
  empresa_calificada: boolean | null;
  razon_no_empresa: string;
  razon_no_empresa_otro: string;
  contacto_calificado: boolean | null;
  razon_no_califica: string;
  razon_no_califica_otro: string;
  propuesta_comercial: string;
  comentarios_adicionales: string;
  probabilidad_cierre: number | null;
};

const EMPTY_FORM: FormState = {
  sdr_seleccionado: "",
  calificacion: null,
  empresa_calificada: null,
  razon_no_empresa: "",
  razon_no_empresa_otro: "",
  contacto_calificado: null,
  razon_no_califica: "",
  razon_no_califica_otro: "",
  propuesta_comercial: "",
  comentarios_adicionales: "",
  probabilidad_cierre: null,
};

const RAZONES_EMPRESA = [
  "No es de industria objetivo",
  "No es del tamaño objetivo",
  "No es del país objetivo",
  "Otra",
];
const RAZONES_CONTACTO = [
  "No tomaba decisiones",
  "No presentó interés",
  "No tenía contexto de nosotros",
  "Tomó la reunión desde el celular",
  "Otro",
];
const PROPUESTAS = ["Si", "No", "No aún", "Falta otra reunión"];

function StarRating({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value;
  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {Array.from({ length: 10 }, (_, i) => {
          const n = i + 1;
          const active = value === n;
          const highlighted = (hover ?? value ?? 0) >= n;
          return (
            <button key={n} type="button"
              onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}
              onClick={() => onChange(n)}
              className="flex-1 py-1.5 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: active ? "#f59e0b" : highlighted ? "#fef3c7" : "#f9fafb",
                color: active ? "#fff" : highlighted ? "#b45309" : "#9ca3af",
                border: `1.5px solid ${active ? "#f59e0b" : highlighted ? "#fcd34d" : "#e5e7eb"}`,
              }}>
              {n}
            </button>
          );
        })}
      </div>
      <div className="flex gap-1 items-center">
        {Array.from({ length: 10 }, (_, i) => {
          const n = i + 1;
          const filled = (hover ?? value ?? 0) >= n;
          return (
            <button key={n} type="button"
              onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}
              onClick={() => onChange(n)} className="transition-transform hover:scale-110">
              <IconStar size={24} fill={filled ? "#f59e0b" : "none"} stroke={filled ? "#f59e0b" : "#d1d5db"} />
            </button>
          );
        })}
        {display && <span className="ml-2 text-sm text-gray-500 font-medium">{display}/10</span>}
      </div>
    </div>
  );
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

function FeedbackModal({ meeting, salesManagers, onClose, onSaved }: {
  meeting: Meeting; salesManagers: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const fmtFecha = (f: string | null) =>
    f ? new Date(f + "T12:00:00").toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" }) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.calificacion === null) { setError("Por favor califica la reunión"); return; }
    if (form.empresa_calificada === null) { setError("Por favor responde si la empresa era calificada"); return; }
    if (form.contacto_calificado === null) { setError("Por favor responde si el contacto era calificado"); return; }
    if (form.contacto_calificado === false && !form.razon_no_califica) { setError("Por favor indica por qué no calificaba el contacto"); return; }
    if (!form.propuesta_comercial) { setError("Por favor indica el siguiente paso"); return; }
    setSubmitting(true);
    setError("");
    const res = await fetch(`/api/encuesta/${meeting.feedback_token}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    setSubmitting(false);
    if (res.ok) {
      setSubmitted(true);
      setTimeout(() => { onSaved(); onClose(); }, 1800);
    } else {
      const d = await res.json();
      setError(d.error ?? "Error al enviar. Intenta de nuevo.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-gray-50 h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-start justify-between z-10">
          <div>
            <p className="font-semibold text-gray-900">{meeting.empresa}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {[meeting.contacto_nombre, meeting.contacto_cargo].filter(Boolean).join(" · ")}
              {fmtFecha(meeting.fecha_reunion) && ` · ${fmtFecha(meeting.fecha_reunion)}`}
            </p>
          </div>
          <button onClick={onClose} className="ml-4 mt-0.5 text-gray-400 hover:text-gray-600"><IconX size={20} /></button>
        </div>

        {submitted ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(98,224,216,0.15)" }}>
                <IconCheck size={30} style={{ color: "#62E0D8" }} />
              </div>
              <h2 className="text-lg font-semibold text-gray-800">¡Feedback enviado!</h2>
              <p className="text-sm text-gray-500 mt-1">Gracias por completar el formulario.</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 p-5 space-y-4 pb-10">
            {salesManagers.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-1">¿Quién realizó esta reunión?</h3>
                <p className="text-xs text-gray-400 mb-3">Selecciona el ejecutivo responsable</p>
                <select value={form.sdr_seleccionado} onChange={e => setForm(p => ({ ...p, sdr_seleccionado: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-[#62E0D8]">
                  <option value="">— Selecciona —</option>
                  {salesManagers.map(sm => <option key={sm} value={sm}>{sm}</option>)}
                </select>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">1. ¿Cómo calificarías esta reunión?</h3>
              <p className="text-xs text-gray-400 mb-4">1 = muy mala · 10 = excelente</p>
              <StarRating value={form.calificacion} onChange={v => setForm(p => ({ ...p, calificacion: v }))} />
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-4">2. ¿La empresa prospecto era calificada para el servicio?</h3>
              <BoolBtn value={form.empresa_calificada}
                onChange={v => setForm(p => ({ ...p, empresa_calificada: v, razon_no_empresa: v ? "" : p.razon_no_empresa }))} />
              {form.empresa_calificada === false && (
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                  <p className="text-xs font-medium text-gray-600 mb-2">¿Por qué no calificaba la empresa?</p>
                  {RAZONES_EMPRESA.map(r => (
                    <button key={r} type="button" onClick={() => setForm(p => ({ ...p, razon_no_empresa: r }))}
                      className="w-full text-left px-3 py-2 rounded-xl text-sm border-2 transition"
                      style={{ borderColor: form.razon_no_empresa === r ? "#251762" : "#e5e7eb", background: form.razon_no_empresa === r ? "rgba(37,23,98,0.05)" : "#fff", color: form.razon_no_empresa === r ? "#251762" : "#374151", fontWeight: form.razon_no_empresa === r ? 500 : 400 }}>
                      {r}
                    </button>
                  ))}
                  {form.razon_no_empresa === "Otra" && (
                    <textarea value={form.razon_no_empresa_otro} onChange={e => setForm(p => ({ ...p, razon_no_empresa_otro: e.target.value }))}
                      placeholder="Describe el motivo…" rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#62E0D8] resize-none" />
                  )}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-4">3. ¿El contacto era el decisor o influenciador correcto?</h3>
              <BoolBtn value={form.contacto_calificado}
                onChange={v => setForm(p => ({ ...p, contacto_calificado: v, razon_no_califica: v ? "" : p.razon_no_califica }))} />
              {form.contacto_calificado === false && (
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                  <p className="text-xs font-medium text-gray-600 mb-2">¿Por qué no calificaba?</p>
                  {RAZONES_CONTACTO.map(r => (
                    <button key={r} type="button" onClick={() => setForm(p => ({ ...p, razon_no_califica: r }))}
                      className="w-full text-left px-3 py-2 rounded-xl text-sm border-2 transition"
                      style={{ borderColor: form.razon_no_califica === r ? "#251762" : "#e5e7eb", background: form.razon_no_califica === r ? "rgba(37,23,98,0.05)" : "#fff", color: form.razon_no_califica === r ? "#251762" : "#374151", fontWeight: form.razon_no_califica === r ? 500 : 400 }}>
                      {r}
                    </button>
                  ))}
                  {form.razon_no_califica === "Otro" && (
                    <textarea value={form.razon_no_califica_otro} onChange={e => setForm(p => ({ ...p, razon_no_califica_otro: e.target.value }))}
                      placeholder="Describe el motivo…" rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#62E0D8] resize-none" />
                  )}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-4">4. ¿Le enviarás una propuesta comercial a este prospecto?</h3>
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

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">5. ¿Algo más que destacar? <span className="font-normal text-gray-400">(opcional)</span></h3>
              <textarea value={form.comentarios_adicionales} onChange={e => setForm(p => ({ ...p, comentarios_adicionales: e.target.value }))}
                placeholder="Puntos de dolor, contexto relevante, próximos pasos acordados…" rows={3}
                className="mt-3 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#62E0D8] resize-none" />
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">6. ¿Cuál es la probabilidad de cierre?</h3>
              <p className="text-xs text-gray-400 mb-4">Tu estimación intuitiva de que esto termine en negocio</p>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-500">Baja</span>
                <span className="text-2xl font-bold" style={{ color: form.probabilidad_cierre === null ? "#d1d5db" : form.probabilidad_cierre >= 70 ? "#22c55e" : form.probabilidad_cierre >= 40 ? "#f59e0b" : "#ef4444" }}>
                  {form.probabilidad_cierre !== null ? `${form.probabilidad_cierre}%` : "—"}
                </span>
                <span className="text-xs text-gray-500">Alta</span>
              </div>
              <input type="range" min={0} max={100} step={5} value={form.probabilidad_cierre ?? 50}
                onChange={e => setForm(p => ({ ...p, probabilidad_cierre: Number(e.target.value) }))}
                onMouseDown={() => { if (form.probabilidad_cierre === null) setForm(p => ({ ...p, probabilidad_cierre: 50 })); }}
                onTouchStart={() => { if (form.probabilidad_cierre === null) setForm(p => ({ ...p, probabilidad_cierre: 50 })); }}
                className="w-full h-2 rounded-full outline-none cursor-pointer"
                style={{ accentColor: form.probabilidad_cierre === null ? "#d1d5db" : form.probabilidad_cierre >= 70 ? "#22c55e" : form.probabilidad_cierre >= 40 ? "#f59e0b" : "#ef4444" }} />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-0.5">
                <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
              </div>
              <div className="flex gap-2 mt-4 flex-wrap">
                {[
                  { label: "Sin chances", value: 5, color: "#ef4444" },
                  { label: "Poco probable", value: 20, color: "#f97316" },
                  { label: "Posible", value: 40, color: "#f59e0b" },
                  { label: "Probable", value: 65, color: "#84cc16" },
                  { label: "Muy probable", value: 85, color: "#22c55e" },
                ].map(chip => (
                  <button key={chip.value} type="button" onClick={() => setForm(p => ({ ...p, probabilidad_cierre: chip.value }))}
                    className="px-3 py-1 rounded-full text-xs font-medium border-2 transition"
                    style={{ borderColor: form.probabilidad_cierre === chip.value ? chip.color : "#e5e7eb", background: form.probabilidad_cierre === chip.value ? chip.color + "18" : "#fff", color: form.probabilidad_cierre === chip.value ? chip.color : "#6b7280" }}>
                    {chip.label} ({chip.value}%)
                  </button>
                ))}
              </div>
            </div>

            {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>}

            <button type="submit" disabled={submitting}
              className="w-full py-3 rounded-2xl text-white font-semibold text-sm disabled:opacity-50 transition"
              style={{ background: "#251762" }}>
              {submitting ? "Enviando…" : "Enviar feedback"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function FeedbackClientePage() {
  const { token } = useParams() as { token: string };
  const [client, setClient] = useState<ClientData | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [salesManagers, setSalesManagers] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sdrFilter, setSdrFilter] = useState("Todos");
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);

  useEffect(() => {
    fetch(`/api/feedback-cliente/${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setNotFound(true); setLoading(false); return; }
        setClient(data.client);
        setMeetings(data.meetings ?? []);
        setLoading(false);
        if (data.client?.id) {
          fetch(`/api/feedback-config?client_id=${data.client.id}`)
            .then(r => r.ok ? r.json() : null)
            .then(cfg => setSalesManagers(cfg?.config?.sales_managers ?? []))
            .catch(() => {});
        }
      });
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Cargando…</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h1 className="text-xl font-semibold text-gray-800">Link inválido</h1>
          <p className="text-gray-500 text-sm mt-2">Este enlace no existe o expiró.</p>
        </div>
      </div>
    );
  }

  const ejecutivos = Array.from(new Set(meetings.map(m => m.sdr_nombre).filter(Boolean) as string[])).sort();

  const filtered = meetings.filter(m => {
    const matchSearch = !search
      || m.empresa.toLowerCase().includes(search.toLowerCase())
      || (m.contacto_nombre ?? "").toLowerCase().includes(search.toLowerCase());
    const matchSdr = sdrFilter === "Todos" || m.sdr_nombre === sdrFilter;
    return matchSearch && matchSdr;
  });

  const pendientes  = filtered.filter(m => m.feedback_status === "pendiente");
  const conFeedback = filtered.filter(m => m.feedback_status === "con_feedback");

  const fmtFecha = (f: string | null) =>
    f ? new Date(f + "T12:00:00").toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" }) : null;

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-2xl font-bold tracking-tight mb-1">
            <span style={{ color: "#251762" }}>Bulls</span>
            <span style={{ color: "#62E0D8" }}>Eye</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mt-5">Feedback de reuniones</h1>
          {client && <p className="text-sm text-gray-500 mt-1">{client.name}</p>}
          <p className="text-xs text-gray-400 mt-3 max-w-sm mx-auto">
            Aquí puedes completar el feedback de cada reunión realizada. Haz clic en "Dejar feedback" para comenzar.
          </p>
        </div>

        {/* Stats (sobre el total) */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-center gap-3">
            <IconAlertCircle size={22} className="text-amber-500 shrink-0" />
            <div>
              <div className="text-2xl font-bold text-amber-700">{meetings.filter(m => m.feedback_status === "pendiente").length}</div>
              <div className="text-xs text-amber-600 mt-0.5">Pendientes de feedback</div>
            </div>
          </div>
          <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4 flex items-center gap-3">
            <IconMessageCheck size={22} className="text-teal-500 shrink-0" />
            <div>
              <div className="text-2xl font-bold text-teal-700">{meetings.filter(m => m.feedback_status === "con_feedback").length}</div>
              <div className="text-xs text-teal-600 mt-0.5">Con feedback completado</div>
            </div>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-2 mb-6">
          <div className="flex-1 relative">
            <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar empresa o contacto…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-[#62E0D8] bg-white" />
          </div>
          {ejecutivos.length > 0 && (
            <div className="relative">
              <select value={sdrFilter} onChange={e => setSdrFilter(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-[#62E0D8] bg-white text-gray-700">
                <option value="Todos">Todos los ejecutivos</option>
                {ejecutivos.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
              <IconChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          )}
        </div>

        {/* Pendientes */}
        {pendientes.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3 flex items-center gap-2">
              <IconAlertCircle size={15} className="text-amber-500" />
              Pendientes de feedback ({pendientes.length})
            </h2>
            <div className="space-y-3">
              {pendientes.map(m => (
                <div key={m.id} className="bg-white rounded-2xl border-2 border-amber-100 shadow-sm p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{m.empresa}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {[m.contacto_nombre, m.contacto_cargo].filter(Boolean).join(" · ")}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {m.fecha_reunion && (
                        <p className="text-xs text-gray-400 flex items-center gap-1">
                          <IconCalendar size={11} /> {fmtFecha(m.fecha_reunion)}
                        </p>
                      )}
                      {m.sdr_nombre && <p className="text-xs text-gray-400">{m.sdr_nombre}</p>}
                    </div>
                  </div>
                  <button onClick={() => setActiveMeeting(m)}
                    className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition hover:opacity-90"
                    style={{ background: "#251762" }}>
                    <IconMessage2 size={14} /> Dejar feedback
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Con feedback */}
        {conFeedback.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3 flex items-center gap-2">
              <IconCheck size={15} className="text-teal-500" />
              Con feedback completado ({conFeedback.length})
            </h2>
            <div className="space-y-2">
              {conFeedback.map(m => (
                <div key={m.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-4 opacity-70">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-700 truncate">{m.empresa}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {[m.contacto_nombre, m.contacto_cargo].filter(Boolean).join(" · ")}
                    </p>
                    {m.fecha_reunion && (
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                        <IconCalendar size={11} /> {fmtFecha(m.fecha_reunion)}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-teal-50 text-teal-700 border border-teal-100">
                    <IconCheck size={12} /> Completado
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <IconCalendar size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">{search || sdrFilter !== "Todos" ? "Sin resultados para esta búsqueda" : "No hay reuniones realizadas aún"}</p>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-12 pb-6">BullsEye · Plataforma de prospección B2B</p>
      </div>

      {activeMeeting && (
        <FeedbackModal
          meeting={activeMeeting}
          salesManagers={salesManagers}
          onClose={() => setActiveMeeting(null)}
          onSaved={() => {
            setMeetings(prev => prev.map(m =>
              m.id === activeMeeting.id ? { ...m, feedback_status: "con_feedback" } : m
            ));
            setActiveMeeting(null);
          }}
        />
      )}
    </div>
  );
}
