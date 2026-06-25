"use client";

import { useEffect, useState } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconSettings,
  IconPlus,
  IconTrash,
  IconDeviceFloppy,
  IconCheck,
  IconAlertCircle,
  IconGripVertical,
} from "@tabler/icons-react";

type FeedbackConfig = {
  client_id?: string;
  pregunta_calificacion: string;
  pregunta_empresa: string;
  pregunta_contacto: string;
  pregunta_propuesta: string;
  pregunta_comentarios: string;
  razones_no_califica: string[];
  propuesta_opciones: string[];
};

const DEFAULTS: FeedbackConfig = {
  pregunta_calificacion: "¿Cómo calificarías esta reunión?",
  pregunta_empresa:      "¿La empresa es un prospecto calificado?",
  pregunta_contacto:     "¿El contacto era el decisor adecuado?",
  pregunta_propuesta:    "¿Cuál es el próximo paso?",
  pregunta_comentarios:  "Comentarios adicionales",
  razones_no_califica:   ["No tomaba decisiones", "No presentó interés", "No tenía contexto de nosotros", "Tomó la reunión desde el celular", "Otro"],
  propuesta_opciones:    ["Si", "No", "No aún", "Falta otra reunión"],
};

function TagListEditor({
  label,
  hint,
  items,
  onChange,
}: {
  label: string;
  hint?: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [newItem, setNewItem] = useState("");

  function add() {
    const val = newItem.trim();
    if (!val || items.includes(val)) return;
    onChange([...items, val]);
    setNewItem("");
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-500 mb-2">{hint}</p>}
      <div className="flex flex-wrap gap-2 mb-2">
        {items.map((item, idx) => (
          <span key={idx} className="flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700">
            {item}
            <button type="button" onClick={() => remove(idx)}
              className="text-gray-400 hover:text-red-500 transition-colors ml-1">
              <IconTrash size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Agregar opción…"
          className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
        />
        <button type="button" onClick={add}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
          <IconPlus size={14} /> Agregar
        </button>
      </div>
    </div>
  );
}

function TextQuestion({
  label,
  value,
  onChange,
  preview,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  preview?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
      />
      {preview && (
        <p className="text-xs text-gray-400 italic">Vista previa en encuesta: "{value}"</p>
      )}
    </div>
  );
}

export default function ConfiguracionFeedbackPage() {
  const { currentClient, loading: clientLoading } = useClient();
  const [config, setConfig] = useState<FeedbackConfig>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (clientLoading) return;
    if (!currentClient || currentClient.id === "__all__") {
      setConfig(DEFAULTS);
      return;
    }
    setLoading(true);
    setNotice(null); setError(null);
    fetch(`/api/feedback-config?client_id=${currentClient.id}`)
      .then(r => r.json())
      .then(({ config: data }) => {
        setConfig(data ?? DEFAULTS);
        setLoading(false);
      })
      .catch(() => { setError("Error al cargar configuración"); setLoading(false); });
  }, [currentClient?.id, clientLoading]);

  async function save() {
    if (!currentClient || currentClient.id === "__all__") {
      setError("Selecciona un cliente para guardar la configuración");
      return;
    }
    setSaving(true); setNotice(null); setError(null);
    const res = await fetch("/api/feedback-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...config, client_id: currentClient.id }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? "Error al guardar"); return; }
    setNotice("Configuración guardada correctamente");
    setTimeout(() => setNotice(null), 3000);
  }

  function resetDefaults() {
    setConfig(DEFAULTS);
  }

  const noClientSelected = !currentClient || currentClient.id === "__all__";

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Oportunidades</p>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <IconSettings size={24} className="text-gray-500" />
          Configuración de Feedback
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Personaliza las preguntas y opciones del formulario de feedback por cliente.
        </p>
      </div>

      {/* Aviso sin cliente */}
      {noClientSelected && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <IconAlertCircle size={18} className="text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700">
            Selecciona un cliente en el panel lateral para ver y editar su configuración de feedback.
            Los cambios aquí mostrados son los valores por defecto.
          </p>
        </div>
      )}

      {/* Mensajes */}
      {notice && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4 flex items-center gap-2 text-sm text-green-700">
          <IconCheck size={16} /> {notice}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-center gap-2 text-sm text-red-600">
          <IconAlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Cargando configuración…</div>
      ) : (
        <div className="space-y-8">

          {/* Sección: Preguntas de texto */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-800 mb-1">Textos de las preguntas</h2>
            <p className="text-xs text-gray-500 mb-5">Estos textos se muestran en el formulario que recibe el SDR después de cada reunión.</p>
            <div className="space-y-4">
              <TextQuestion
                label="Pregunta de calificación (1–10)"
                value={config.pregunta_calificacion}
                onChange={v => setConfig(c => ({ ...c, pregunta_calificacion: v }))}
                preview
              />
              <TextQuestion
                label="Pregunta sobre la empresa"
                value={config.pregunta_empresa}
                onChange={v => setConfig(c => ({ ...c, pregunta_empresa: v }))}
                preview
              />
              <TextQuestion
                label="Pregunta sobre el contacto"
                value={config.pregunta_contacto}
                onChange={v => setConfig(c => ({ ...c, pregunta_contacto: v }))}
                preview
              />
              <TextQuestion
                label="Pregunta de próximo paso"
                value={config.pregunta_propuesta}
                onChange={v => setConfig(c => ({ ...c, pregunta_propuesta: v }))}
                preview
              />
              <TextQuestion
                label="Etiqueta de comentarios"
                value={config.pregunta_comentarios}
                onChange={v => setConfig(c => ({ ...c, pregunta_comentarios: v }))}
                preview
              />
            </div>
          </div>

          {/* Sección: Razones de no califica */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-800 mb-1">Razones "no califica el contacto"</h2>
            <p className="text-xs text-gray-500 mb-4">Opciones que el SDR ve cuando marca que el contacto no era el decisor adecuado.</p>
            <TagListEditor
              label="Opciones disponibles"
              hint='Presiona Enter o "Agregar" para añadir. Haz clic en la x para eliminar.'
              items={config.razones_no_califica}
              onChange={items => setConfig(c => ({ ...c, razones_no_califica: items }))}
            />
          </div>

          {/* Sección: Opciones de propuesta */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-800 mb-1">Opciones de próximo paso</h2>
            <p className="text-xs text-gray-500 mb-4">Las opciones que aparecen para "¿Cuál es el próximo paso?" en el formulario.</p>
            <TagListEditor
              label="Opciones disponibles"
              hint='Presiona Enter o "Agregar" para añadir. Haz clic en la x para eliminar.'
              items={config.propuesta_opciones}
              onChange={items => setConfig(c => ({ ...c, propuesta_opciones: items }))}
            />
          </div>

          {/* Vista previa */}
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6">
            <h2 className="text-base font-semibold text-gray-700 mb-4">Vista previa del formulario</h2>
            <div className="space-y-4 text-sm text-gray-600">
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                <div><p className="font-medium text-gray-800">{config.pregunta_calificacion}</p><p className="text-xs text-gray-400 mt-0.5">Escala 1–10 estrellas</p></div>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                <div><p className="font-medium text-gray-800">{config.pregunta_empresa}</p><p className="text-xs text-gray-400 mt-0.5">Sí / No</p></div>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
                <div>
                  <p className="font-medium text-gray-800">{config.pregunta_contacto}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Sí / No → Si No: {config.razones_no_califica.join(", ")}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">4</span>
                <div>
                  <p className="font-medium text-gray-800">{config.pregunta_propuesta}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{config.propuesta_opciones.join(" · ")}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">5</span>
                <div><p className="font-medium text-gray-800">{config.pregunta_comentarios}</p><p className="text-xs text-gray-400 mt-0.5">Campo de texto libre</p></div>
              </div>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex items-center justify-between pt-2 pb-8">
            <button type="button" onClick={resetDefaults}
              className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2">
              Restablecer valores por defecto
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || noClientSelected}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-colors"
              style={{ background: "#251762" }}
            >
              <IconDeviceFloppy size={16} />
              {saving ? "Guardando…" : "Guardar configuración"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
