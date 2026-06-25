"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { IconStar, IconCheck, IconX } from "@tabler/icons-react";

type MeetingData = {
  id: string;
  empresa: string;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  fecha_reunion: string | null;
  feedback_status: "pendiente" | "con_feedback";
};

type FormState = {
  calificacion: number | null;
  empresa_calificada: boolean | null;
  contacto_calificado: boolean | null;
  razon_no_califica: string;
  razon_no_califica_otro: string;
  propuesta_comercial: string;
  comentarios_adicionales: string;
};

const RAZONES = [
  "No tomaba decisiones",
  "No presentó interés",
  "No tenía contexto de nosotros",
  "Tomó la reunión desde el celular",
  "Otro",
];

const PROPUESTAS = ["Si", "No", "No aún", "Falta otra reunión"];

function StarRating({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="flex gap-1">
      {Array.from({ length: 10 }, (_, i) => {
        const n = i + 1;
        const filled = (hover ?? value ?? 0) >= n;
        return (
          <button key={n} type="button"
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onChange(n)}
            className="transition-transform hover:scale-110">
            <IconStar size={28} fill={filled ? "#f59e0b" : "none"}
              stroke={filled ? "#f59e0b" : "#d1d5db"} />
          </button>
        );
      })}
      {value && <span className="ml-2 text-sm text-gray-600 self-center font-medium">{value}/10</span>}
    </div>
  );
}

function BoolBtn({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => onChange(true)}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border-2 transition"
        style={{
          borderColor: value === true ? "#22c55e" : "#e5e7eb",
          background: value === true ? "#f0fdf4" : "#fff",
          color: value === true ? "#16a34a" : "#6b7280"
        }}>
        <IconCheck size={15} /> Sí
      </button>
      <button type="button" onClick={() => onChange(false)}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border-2 transition"
        style={{
          borderColor: value === false ? "#ef4444" : "#e5e7eb",
          background: value === false ? "#fef2f2" : "#fff",
          color: value === false ? "#dc2626" : "#6b7280"
        }}>
        <IconX size={15} /> No
      </button>
    </div>
  );
}

export default function EncuestaPage() {
  const { token } = useParams() as { token: string };
  const [meeting, setMeeting] = useState<MeetingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState<FormState>({
    calificacion: null,
    empresa_calificada: null,
    contacto_calificado: null,
    razon_no_califica: "",
    razon_no_califica_otro: "",
    propuesta_comercial: "",
    comentarios_adicionales: "",
  });

  useEffect(() => {
    fetch(`/api/encuesta/${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setNotFound(true); setLoading(false); return; }
        if (data.feedback_status === "con_feedback") setSubmitted(true);
        setMeeting(data);
        setLoading(false);
      });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.calificacion === null) { setError("Por favor califica la reunión"); return; }
    if (form.empresa_calificada === null) { setError("Por favor responde si la empresa era calificada"); return; }
    if (form.contacto_calificado === null) { setError("Por favor responde si el contacto era calificado"); return; }
    if (form.contacto_calificado === false && !form.razon_no_califica) { setError("Por favor indica por qué no calificaba el contacto"); return; }
    if (!form.propuesta_comercial) { setError("Por favor indica el siguiente paso"); return; }

    setSubmitting(true);
    setError("");
    const res = await fetch(`/api/encuesta/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSubmitting(false);
    if (res.ok) setSubmitted(true);
    else {
      const d = await res.json();
      setError(d.error ?? "Error al enviar. Intenta de nuevo.");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Cargando encuesta…</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h1 className="text-xl font-semibold text-gray-800">Encuesta no encontrada</h1>
          <p className="text-gray-500 text-sm mt-2">El link puede estar desactualizado o ser incorrecto.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{ background: "rgba(98,224,216,0.15)" }}>
            <IconCheck size={32} style={{ color: "#62E0D8" }} />
          </div>
          <h1 className="text-xl font-semibold text-gray-800">¡Gracias por tu feedback!</h1>
          <p className="text-gray-500 text-sm mt-2">Tu respuesta fue registrada correctamente.</p>
          {meeting && (
            <p className="text-xs text-gray-400 mt-4">
              Reunión con {meeting.empresa}
              {meeting.contacto_nombre && ` · ${meeting.contacto_nombre}`}
            </p>
          )}
        </div>
      </div>
    );
  }

  const fecha = meeting?.fecha_reunion
    ? new Date(meeting.fecha_reunion + "T12:00:00").toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-2xl font-bold tracking-tight mb-1">
            <span style={{ color: "#251762" }}>Bulls</span>
            <span style={{ color: "#62E0D8" }}>Eye</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mt-4">{meeting?.empresa}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {[meeting?.contacto_nombre, meeting?.contacto_cargo].filter(Boolean).join(" · ")}
            {fecha && ` · ${fecha}`}
          </p>
          <p className="text-xs text-gray-400 mt-3">
            Comparte tu experiencia de esta reunión — te toma menos de 2 minutos
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* P1: Calificación */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-1">
              1. ¿Cómo calificarías esta reunión?
            </h2>
            <p className="text-xs text-gray-400 mb-4">1 = muy mala · 10 = excelente</p>
            <StarRating value={form.calificacion} onChange={v => setForm(p => ({ ...p, calificacion: v }))} />
          </div>

          {/* P2: Empresa calificada */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">
              2. ¿La empresa prospecto era calificada para el servicio?
            </h2>
            <BoolBtn value={form.empresa_calificada} onChange={v => setForm(p => ({ ...p, empresa_calificada: v }))} />
          </div>

          {/* P3: Contacto calificado */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">
              3. ¿El contacto era el decisor o influenciador correcto?
            </h2>
            <BoolBtn value={form.contacto_calificado} onChange={v => setForm(p => ({ ...p, contacto_calificado: v, razon_no_califica: v ? "" : p.razon_no_califica }))} />

            {/* Sub-pregunta si no calificaba */}
            {form.contacto_calificado === false && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-600 mb-3">¿Por qué no calificaba?</p>
                <div className="space-y-2">
                  {RAZONES.map(r => (
                    <button key={r} type="button"
                      onClick={() => setForm(p => ({ ...p, razon_no_califica: r }))}
                      className="w-full text-left px-3 py-2 rounded-xl text-sm border-2 transition"
                      style={{
                        borderColor: form.razon_no_califica === r ? "#251762" : "#e5e7eb",
                        background: form.razon_no_califica === r ? "rgba(37,23,98,0.05)" : "#fff",
                        color: form.razon_no_califica === r ? "#251762" : "#374151",
                        fontWeight: form.razon_no_califica === r ? 500 : 400
                      }}>
                      {r}
                    </button>
                  ))}
                  {form.razon_no_califica === "Otro" && (
                    <textarea
                      value={form.razon_no_califica_otro}
                      onChange={e => setForm(p => ({ ...p, razon_no_califica_otro: e.target.value }))}
                      placeholder="Describe el motivo…"
                      rows={2}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#62E0D8] resize-none mt-1" />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* P4: Siguiente paso */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">
              4. ¿Le enviarás una propuesta comercial a este prospecto?
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {PROPUESTAS.map(p => (
                <button key={p} type="button"
                  onClick={() => setForm(prev => ({ ...prev, propuesta_comercial: p }))}
                  className="px-3 py-2.5 rounded-xl text-sm border-2 transition text-center font-medium"
                  style={{
                    borderColor: form.propuesta_comercial === p ? "#62E0D8" : "#e5e7eb",
                    background: form.propuesta_comercial === p ? "rgba(98,224,216,0.1)" : "#fff",
                    color: form.propuesta_comercial === p ? "#0f766e" : "#374151",
                  }}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* P5: Comentarios opcionales */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-1">
              5. ¿Algo más que destacar? <span className="font-normal text-gray-400">(opcional)</span>
            </h2>
            <textarea
              value={form.comentarios_adicionales}
              onChange={e => setForm(p => ({ ...p, comentarios_adicionales: e.target.value }))}
              placeholder="Puntos de dolor mencionados, contexto relevante, próximos pasos acordados…"
              rows={3}
              className="mt-3 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#62E0D8] resize-none" />
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">
              {error}
            </div>
          )}

          <button type="submit" disabled={submitting}
            className="w-full py-3 rounded-2xl text-white font-semibold text-sm disabled:opacity-50 transition"
            style={{ background: "#251762" }}>
            {submitting ? "Enviando…" : "Enviar feedback"}
          </button>

          <p className="text-center text-xs text-gray-400 pb-6">
            BullsEye · Plataforma de prospección B2B
          </p>
        </form>
      </div>
    </div>
  );
}
