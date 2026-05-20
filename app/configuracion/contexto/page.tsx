"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconPlus,
  IconTrash,
  IconFileText,
  IconLoader2,
  IconBrain,
  IconUpload,
  IconCheck,
  IconX
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";

type ContextItem = {
  id: string;
  file_name: string;
  file_type: string;
  content: string;
  uploaded_at: string;
};

const FILE_TYPES = [
  { value: "icp",          label: "ICP" },
  { value: "one_pager",    label: "One Pager" },
  { value: "presentacion", label: "Presentación" },
  { value: "caso_uso",     label: "Caso de uso" },
  { value: "propuesta",    label: "Propuesta" },
  { value: "otro",         label: "Otro" }
];

const TYPE_COLORS: Record<string, string> = {
  icp:          "bg-brand-tint text-brand",
  one_pager:    "bg-info-bg text-info-fg",
  presentacion: "bg-warning-bg text-warning-fg",
  caso_uso:     "bg-success-bg text-success-fg",
  propuesta:    "bg-[#F1EEF7] text-ink-muted",
  otro:         "bg-[#F1EEF7] text-ink-subtle"
};

function typeLabel(type: string) {
  return FILE_TYPES.find((t) => t.value === type)?.label ?? type;
}

function formatBytes(n: number) {
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(1)}k chars`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

type FormState = {
  file_name: string;
  file_type: string;
  content: string;
};

const EMPTY_FORM: FormState = { file_name: "", file_type: "icp", content: "" };

export default function ContextoPage() {
  const { currentClient } = useClient();
  const [items, setItems]     = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]       = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving]   = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!currentClient) return;
    setLoading(true);
    setError(null);
    const r = await fetch(`/api/clients/${currentClient.id}/context`, { cache: "no-store" });
    const j = await r.json();
    setLoading(false);
    if (j.error) { setError(j.error); return; }
    setItems(j.items ?? []);
  }

  useEffect(() => {
    load();
    setShowForm(false);
  }, [currentClient?.id]);

  // Leer archivo .txt / .md desde el input de file
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.replace(/\.[^.]+$/, "");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? "";
      setForm((f) => ({ ...f, file_name: f.file_name || name, content: text }));
    };
    reader.readAsText(file, "utf-8");
    // Reset para poder subir el mismo archivo dos veces
    e.target.value = "";
  }

  async function save() {
    if (!currentClient) return;
    setSaving(true);
    setFormError(null);
    const r = await fetch(`/api/clients/${currentClient.id}/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const j = await r.json();
    setSaving(false);
    if (j.error) { setFormError(j.error); return; }
    setItems((prev) => [j.item, ...prev]);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  async function remove(item: ContextItem) {
    if (!currentClient) return;
    setDeletingId(item.id);
    const r = await fetch(`/api/clients/${currentClient.id}/context/${item.id}`, {
      method: "DELETE"
    });
    setDeletingId(null);
    if (r.ok) {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      if (expandedId === item.id) setExpandedId(null);
    }
  }

  const totalChars = items.reduce((acc, i) => acc + (i.content?.length ?? 0), 0);

  if (!currentClient) {
    return (
      <div className="card flex items-center gap-3 text-warning-fg border border-warning-bg bg-warning-bg/40 text-sm max-w-xl">
        <IconAlertCircle size={18} className="shrink-0" />
        Selecciona un cliente en el sidebar para gestionar su contexto IA.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <header className="flex items-end justify-between">
        <div>
          <div className="label">Sistema · Configuración</div>
          <h1 className="text-2xl font-semibold tracking-tight">Contexto IA</h1>
          <div className="flex items-center gap-2 mt-1">
            <div
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
              style={{ background: "#251762" }}
            >
              {currentClient.name}
            </div>
            <span className="text-sm text-ink-muted">
              Documentos que el agente IA usará como contexto al prospectar.
            </span>
          </div>
        </div>
        <button
          className="btn-primary"
          onClick={() => { setShowForm(true); setFormError(null); setForm(EMPTY_FORM); }}
          disabled={showForm}
        >
          <IconPlus size={16} /> Agregar documento
        </button>
      </header>

      {/* Resumen */}
      {items.length > 0 && (
        <div className="flex items-center gap-4 text-sm text-ink-muted">
          <span className="flex items-center gap-1.5">
            <IconFileText size={14} />
            {items.length} documento{items.length !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1.5">
            <IconBrain size={14} />
            {formatBytes(totalChars)} de contexto total
          </span>
        </div>
      )}

      {/* Formulario de carga */}
      {showForm && (
        <div className="card border-2 space-y-4" style={{ borderColor: "#62E0D8" }}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <IconBrain size={18} style={{ color: "#62E0D8" }} />
              Nuevo documento de contexto
            </h2>
            <button
              className="btn-secondary py-1 px-2"
              onClick={() => setShowForm(false)}
            >
              <IconX size={14} />
            </button>
          </div>

          {formError && (
            <p className="text-danger-fg text-sm bg-danger-bg rounded-lg px-3 py-2">{formError}</p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label block mb-1">Nombre del documento *</label>
              <input
                className="input"
                placeholder="Ej. ICP BullsEye v2"
                value={form.file_name}
                onChange={(e) => setForm((f) => ({ ...f, file_name: e.target.value }))}
                autoFocus
              />
            </div>
            <div>
              <label className="label block mb-1">Tipo</label>
              <select
                className="input"
                value={form.file_type}
                onChange={(e) => setForm((f) => ({ ...f, file_type: e.target.value }))}
              >
                {FILE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label">Contenido *</label>
              <button
                className="btn-secondary py-1 px-2 text-xs flex items-center gap-1"
                onClick={() => fileRef.current?.click()}
                title="Cargar desde archivo .txt o .md"
              >
                <IconUpload size={12} /> Cargar .txt / .md
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.markdown,.text"
                className="hidden"
                onChange={handleFile}
              />
            </div>
            <textarea
              className="input min-h-[220px] font-mono text-xs leading-relaxed"
              placeholder={"Pega aquí el contenido del documento. Puede ser:\n- El ICP completo (tipos de empresa, señales, tamaños)\n- Un one pager de la propuesta de valor\n- Notas de contexto del cliente\n- Casos de uso exitosos\n- Cualquier documento que el agente IA deba conocer"}
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            />
            {form.content && (
              <p className="text-xs text-ink-subtle mt-1 text-right">
                {formatBytes(form.content.length)}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              className="btn-primary flex-1"
              onClick={save}
              disabled={saving || !form.file_name.trim() || !form.content.trim()}
            >
              {saving ? <IconLoader2 size={15} className="animate-spin" /> : <IconCheck size={15} />}
              {saving ? "Guardando…" : "Guardar documento"}
            </button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Error de carga */}
      {error && (
        <div className="card text-danger-fg flex items-center gap-2 text-sm">
          <IconAlertCircle size={16} /> {error}
        </div>
      )}

      {/* Estado vacío */}
      {!loading && !error && items.length === 0 && !showForm && (
        <div className="card text-center py-10">
          <IconBrain size={36} className="mx-auto mb-3 text-ink-subtle" />
          <p className="font-medium text-ink">Sin documentos de contexto todavía</p>
          <p className="text-sm text-ink-muted mt-1 max-w-sm mx-auto">
            Agrega el ICP, one pager, propuesta de valor o cualquier documento que el agente
            deba conocer para prospectar mejor.
          </p>
          <button
            className="btn-primary mt-4 mx-auto"
            onClick={() => { setShowForm(true); setFormError(null); setForm(EMPTY_FORM); }}
          >
            <IconPlus size={16} /> Agregar primer documento
          </button>
        </div>
      )}

      {/* Lista de documentos */}
      {loading && (
        <div className="card flex items-center gap-3 text-ink-muted">
          <IconLoader2 size={18} className="animate-spin" /> Cargando documentos…
        </div>
      )}

      <div className="space-y-3">
        {items.map((item) => {
          const expanded = expandedId === item.id;
          return (
            <div key={item.id} className="card">
              {/* Cabecera del item */}
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-ink truncate">{item.file_name}</h3>
                    <span className={`badge ${TYPE_COLORS[item.file_type] ?? TYPE_COLORS.otro}`}>
                      {typeLabel(item.file_type)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-ink-subtle">
                    <span>{formatBytes(item.content?.length ?? 0)}</span>
                    <span>·</span>
                    <span>{formatDate(item.uploaded_at)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    className="btn-secondary py-1 px-2 text-xs"
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                  >
                    {expanded ? "Ocultar" : "Ver"}
                  </button>
                  <button
                    className="btn-secondary py-1 px-2 text-danger-fg"
                    onClick={() => remove(item)}
                    disabled={deletingId === item.id}
                    title="Eliminar"
                  >
                    {deletingId === item.id
                      ? <IconLoader2 size={14} className="animate-spin" />
                      : <IconTrash size={14} />}
                  </button>
                </div>
              </div>

              {/* Contenido expandido */}
              {expanded && (
                <div className="mt-3 pt-3 border-t border-[#E5E2F0]">
                  <pre className="text-xs text-ink/80 whitespace-pre-wrap break-words leading-relaxed max-h-[300px] overflow-y-auto font-mono bg-canvas rounded-lg p-3">
                    {item.content}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
