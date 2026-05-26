"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconAlertCircle, IconPlus, IconTrash, IconFileText, IconLoader2,
  IconBrain, IconUpload, IconCheck, IconX, IconWand, IconSettings2,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ContextItem = {
  id: string; file_name: string; file_type: string;
  content: string; uploaded_at: string;
};

type TrainingConfig = {
  language: string;
  register: string;
  icebreaker_max_chars: number;
  subject_max_words: number;
  body_max_words: number | null;
  value_props: string[];
  talking_points: string[];
  forbidden_phrases: string[];
  required_phrases: string[];
  strong_decision_maker_keywords: string[];
  exclude_role_keywords: string[];
  notes: string;
};

const DEFAULT_CONFIG: TrainingConfig = {
  language: "es", register: "", icebreaker_max_chars: 180,
  subject_max_words: 7, body_max_words: null,
  value_props: [], talking_points: [], forbidden_phrases: [],
  required_phrases: [], strong_decision_maker_keywords: [], exclude_role_keywords: [],
  notes: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FILE_TYPES = [
  { value: "icp", label: "ICP" }, { value: "one_pager", label: "One Pager" },
  { value: "presentacion", label: "Presentación" }, { value: "caso_uso", label: "Caso de uso" },
  { value: "propuesta", label: "Propuesta" }, { value: "otro", label: "Otro" },
];

const TYPE_COLORS: Record<string, string> = {
  icp: "bg-brand-tint text-brand", one_pager: "bg-info-bg text-info-fg",
  presentacion: "bg-warning-bg text-warning-fg", caso_uso: "bg-success-bg text-success-fg",
  propuesta: "bg-[#F1EEF7] text-ink-muted", otro: "bg-[#F1EEF7] text-ink-subtle",
};

function typeLabel(t: string) { return FILE_TYPES.find((f) => f.value === t)?.label ?? t; }
function formatBytes(n: number) { return n < 1000 ? `${n} chars` : `${(n / 1000).toFixed(1)}k chars`; }
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── TagList: campo de lista editable ─────────────────────────────────────────

function TagList({
  label, hint, items, onChange, placeholder = "Agregar...",
}: {
  label: string; hint?: string; items: string[];
  onChange: (v: string[]) => void; placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setDraft("");
  }

  return (
    <div>
      <label className="label block mb-1">{label}</label>
      {hint && <p className="text-xs text-ink-subtle mb-2">{hint}</p>}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium"
            style={{ background: "rgba(98,224,216,0.15)", color: "#62E0D8" }}
          >
            {item}
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="ml-0.5 hover:text-white"
            >
              <IconX size={10} />
            </button>
          </span>
        ))}
        {items.length === 0 && (
          <span className="text-xs text-ink-subtle italic">Sin items todavía</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          className="input flex-1 py-1.5 text-sm"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button className="btn-secondary py-1.5 px-3 text-sm" onClick={add}>
          <IconPlus size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Sección: Documentos de contexto ─────────────────────────────────────────

function DocumentosSection({ clientId }: { clientId: string }) {
  const [items, setItems]         = useState<ContextItem[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState({ file_name: "", file_type: "icp", content: "" });
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true); setError(null);
    const r = await fetch(`/api/clients/${clientId}/context`, { cache: "no-store" });
    const j = await r.json();
    setLoading(false);
    if (j.error) { setError(j.error); return; }
    setItems(j.items ?? []);
  }

  useEffect(() => { load(); setShowForm(false); }, [clientId]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const name = file.name.replace(/\.[^.]+$/, "");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? "";
      setForm((f) => ({ ...f, file_name: f.file_name || name, content: text }));
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }

  async function save() {
    setSaving(true); setFormError(null);
    const r = await fetch(`/api/clients/${clientId}/context`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = await r.json(); setSaving(false);
    if (j.error) { setFormError(j.error); return; }
    setItems((prev) => [j.item, ...prev]);
    setForm({ file_name: "", file_type: "icp", content: "" }); setShowForm(false);
  }

  async function remove(item: ContextItem) {
    setDeletingId(item.id);
    const r = await fetch(`/api/clients/${clientId}/context/${item.id}`, { method: "DELETE" });
    setDeletingId(null);
    if (r.ok) { setItems((prev) => prev.filter((i) => i.id !== item.id)); if (expandedId === item.id) setExpandedId(null); }
  }

  const totalChars = items.reduce((acc, i) => acc + (i.content?.length ?? 0), 0);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-ink flex items-center gap-2">
            <IconFileText size={18} style={{ color: "#62E0D8" }} /> Documentos de contexto
          </h2>
          {items.length > 0 && (
            <p className="text-xs text-ink-subtle mt-0.5">
              {items.length} documento{items.length !== 1 ? "s" : ""} · {formatBytes(totalChars)} total
            </p>
          )}
        </div>
        <button
          className="btn-primary"
          onClick={() => { setShowForm(true); setFormError(null); setForm({ file_name: "", file_type: "icp", content: "" }); }}
          disabled={showForm}
        >
          <IconPlus size={16} /> Agregar documento
        </button>
      </div>

      {showForm && (
        <div className="card border-2 space-y-4" style={{ borderColor: "#62E0D8" }}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <IconBrain size={16} style={{ color: "#62E0D8" }} /> Nuevo documento
            </h3>
            <button className="btn-secondary py-1 px-2" onClick={() => setShowForm(false)}>
              <IconX size={14} />
            </button>
          </div>
          {formError && <p className="text-danger-fg text-sm bg-danger-bg rounded-lg px-3 py-2">{formError}</p>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label block mb-1">Nombre *</label>
              <input className="input" placeholder="Ej. ICP BullsEye v2" value={form.file_name}
                onChange={(e) => setForm((f) => ({ ...f, file_name: e.target.value }))} autoFocus />
            </div>
            <div>
              <label className="label block mb-1">Tipo</label>
              <select className="input" value={form.file_type}
                onChange={(e) => setForm((f) => ({ ...f, file_type: e.target.value }))}>
                {FILE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label">Contenido *</label>
              <button className="btn-secondary py-1 px-2 text-xs flex items-center gap-1"
                onClick={() => fileRef.current?.click()}>
                <IconUpload size={12} /> Cargar .txt / .md
              </button>
              <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.text"
                className="hidden" onChange={handleFile} />
            </div>
            <textarea className="input min-h-[200px] font-mono text-xs" value={form.content}
              placeholder="Pega el contenido del documento..." onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} />
            {form.content && <p className="text-xs text-ink-subtle mt-1 text-right">{formatBytes(form.content.length)}</p>}
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={save}
              disabled={saving || !form.file_name.trim() || !form.content.trim()}>
              {saving ? <IconLoader2 size={15} className="animate-spin" /> : <IconCheck size={15} />}
              {saving ? "Guardando…" : "Guardar documento"}
            </button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {error && <div className="card text-danger-fg flex items-center gap-2 text-sm"><IconAlertCircle size={16} />{error}</div>}
      {loading && <div className="card flex items-center gap-3 text-ink-muted"><IconLoader2 size={18} className="animate-spin" /> Cargando…</div>}

      {!loading && !error && items.length === 0 && !showForm && (
        <div className="card text-center py-10">
          <IconBrain size={36} className="mx-auto mb-3 text-ink-subtle" />
          <p className="font-medium text-ink">Sin documentos todavía</p>
          <p className="text-sm text-ink-muted mt-1 max-w-sm mx-auto">
            Agrega el ICP, one pager o propuesta de valor para que el agente IA tenga contexto al prospectar.
          </p>
          <button className="btn-primary mt-4 mx-auto"
            onClick={() => { setShowForm(true); setFormError(null); }}>
            <IconPlus size={16} /> Agregar primer documento
          </button>
        </div>
      )}

      <div className="space-y-3">
        {items.map((item) => {
          const expanded = expandedId === item.id;
          return (
            <div key={item.id} className="card">
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
                    <span>·</span><span>{formatDate(item.uploaded_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="btn-secondary py-1 px-2 text-xs"
                    onClick={() => setExpandedId(expanded ? null : item.id)}>
                    {expanded ? "Ocultar" : "Ver"}
                  </button>
                  <button className="btn-secondary py-1 px-2 text-danger-fg"
                    onClick={() => remove(item)} disabled={deletingId === item.id} title="Eliminar">
                    {deletingId === item.id ? <IconLoader2 size={14} className="animate-spin" /> : <IconTrash size={14} />}
                  </button>
                </div>
              </div>
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
    </section>
  );
}

// ─── Sección: Configuración de mensajes ───────────────────────────────────────

function MensajesSection({ clientId }: { clientId: string }) {
  const [config, setConfig]   = useState<TrainingConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    const r = await fetch(`/api/clients/${clientId}/training-config`, { cache: "no-store" });
    const j = await r.json(); setLoading(false);
    if (j.error) { setError(j.error); return; }
    if (j.config) {
      setConfig({
        language:                      j.config.language                      ?? "es",
        register:                      j.config.register                      ?? "",
        icebreaker_max_chars:          j.config.icebreaker_max_chars          ?? 180,
        subject_max_words:             j.config.subject_max_words             ?? 7,
        body_max_words:                j.config.body_max_words                ?? null,
        value_props:                   j.config.value_props                   ?? [],
        talking_points:                j.config.talking_points                ?? [],
        forbidden_phrases:             j.config.forbidden_phrases             ?? [],
        required_phrases:              j.config.required_phrases              ?? [],
        strong_decision_maker_keywords: j.config.strong_decision_maker_keywords ?? [],
        exclude_role_keywords:         j.config.exclude_role_keywords         ?? [],
        notes:                         j.config.notes                         ?? "",
      });
    }
  }

  useEffect(() => { load(); }, [clientId]);

  async function save() {
    setSaving(true); setError(null);
    const r = await fetch(`/api/clients/${clientId}/training-config`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const j = await r.json(); setSaving(false);
    if (j.error) { setError(j.error); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2500);
  }

  function set<K extends keyof TrainingConfig>(k: K, v: TrainingConfig[K]) {
    setConfig((c) => ({ ...c, [k]: v }));
  }

  if (loading) return <div className="card flex items-center gap-3 text-ink-muted"><IconLoader2 size={18} className="animate-spin" /> Cargando configuración…</div>;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-ink flex items-center gap-2">
            <IconWand size={18} style={{ color: "#62E0D8" }} /> Configuración de mensajes
          </h2>
          <p className="text-xs text-ink-subtle mt-0.5">
            Personaliza el tono, talking points y frases que usa Claude al generar icebreakers y emails.
          </p>
        </div>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? <IconLoader2 size={15} className="animate-spin" /> : saved ? <IconCheck size={15} /> : <IconSettings2 size={15} />}
          {saving ? "Guardando…" : saved ? "Guardado" : "Guardar cambios"}
        </button>
      </div>

      {error && <p className="text-danger-fg text-sm bg-danger-bg rounded-lg px-3 py-2">{error}</p>}

      <div className="card space-y-5">
        <h3 className="font-medium text-sm text-ink-muted uppercase tracking-wide">Formato y tono</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label block mb-1">Idioma</label>
            <select className="input" value={config.language} onChange={(e) => set("language", e.target.value)}>
              <option value="es">Español (es)</option>
              <option value="en">English (en)</option>
            </select>
          </div>
          <div>
            <label className="label block mb-1">Registro / tono</label>
            <input className="input" placeholder="Ej: profesional pero cercano, sin jerga técnica"
              value={config.register} onChange={(e) => set("register", e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label block mb-1">Icebreaker — máx. chars</label>
            <input type="number" className="input" min={80} max={300}
              value={config.icebreaker_max_chars}
              onChange={(e) => set("icebreaker_max_chars", Number(e.target.value))} />
          </div>
          <div>
            <label className="label block mb-1">Asunto email — máx. palabras</label>
            <input type="number" className="input" min={3} max={15}
              value={config.subject_max_words}
              onChange={(e) => set("subject_max_words", Number(e.target.value))} />
          </div>
          <div>
            <label className="label block mb-1">Email body — máx. palabras</label>
            <input type="number" className="input" min={0} max={500}
              placeholder="Sin límite"
              value={config.body_max_words ?? ""}
              onChange={(e) => set("body_max_words", e.target.value ? Number(e.target.value) : null)} />
          </div>
        </div>
      </div>

      <div className="card space-y-5">
        <h3 className="font-medium text-sm text-ink-muted uppercase tracking-wide">Contenido de mensajes</h3>
        <TagList label="Value propositions" hint="Frases que describen el valor del producto/servicio. Se inyectan al prompt en orden de prioridad."
          items={config.value_props} onChange={(v) => set("value_props", v)}
          placeholder="Ej: Pipeline B2B predecible sin contratar SDRs internos" />
        <div className="border-t border-[#E5E2F0]" />
        <TagList label="Talking points" hint="Ideas específicas que Claude debe intentar incluir en los mensajes."
          items={config.talking_points} onChange={(v) => set("talking_points", v)}
          placeholder="Ej: Primeros resultados en menos de 30 días" />
        <div className="border-t border-[#E5E2F0]" />
        <TagList label="Frases requeridas" hint="Conceptos o frases que siempre deben aparecer."
          items={config.required_phrases} onChange={(v) => set("required_phrases", v)}
          placeholder="Ej: outbound personalizado" />
        <div className="border-t border-[#E5E2F0]" />
        <TagList label="Frases prohibidas" hint="Palabras o frases que Claude nunca debe usar."
          items={config.forbidden_phrases} onChange={(v) => set("forbidden_phrases", v)}
          placeholder="Ej: sinergias, disruptivo, solución innovadora" />
      </div>

      <div className="card space-y-5">
        <h3 className="font-medium text-sm text-ink-muted uppercase tracking-wide">Auto-promote y filtros</h3>
        <TagList
          label="Cargos que se auto-aprueban (strong decision makers)"
          hint="Contactos con estos títulos saltan la revisión manual y van directo a campaña."
          items={config.strong_decision_maker_keywords}
          onChange={(v) => set("strong_decision_maker_keywords", v)}
          placeholder="Ej: CEO, Founder, CMO, VP Marketing" />
        <div className="border-t border-[#E5E2F0]" />
        <TagList
          label="Cargos a excluir"
          hint="Contactos con estos títulos se descartan automáticamente."
          items={config.exclude_role_keywords}
          onChange={(v) => set("exclude_role_keywords", v)}
          placeholder="Ej: intern, practicante, asistente" />
      </div>

      <div className="card">
        <label className="label block mb-2">Notas internas (no se inyectan al prompt)</label>
        <textarea className="input min-h-[80px] text-sm" placeholder="Notas de referencia para el equipo…"
          value={config.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>

      <div className="flex justify-end">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? <IconLoader2 size={15} className="animate-spin" /> : saved ? <IconCheck size={15} /> : <IconSettings2 size={15} />}
          {saving ? "Guardando…" : saved ? "¡Guardado!" : "Guardar configuración"}
        </button>
      </div>
    </section>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

type Tab = "documentos" | "mensajes";

export default function ContextoPage() {
  const { currentClient } = useClient();
  const [tab, setTab] = useState<Tab>("documentos");

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
      <header>
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
            Contexto e instrucciones que el agente IA usa al prospectar.
          </span>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(37,23,98,0.06)" }}>
        {(["documentos", "mensajes"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all"
            style={tab === t
              ? { background: "#251762", color: "#fff" }
              : { color: "var(--ink-muted)" }}
          >
            {t === "documentos" ? "📄 Documentos" : "⚙️ Config. de mensajes"}
          </button>
        ))}
      </div>

      {tab === "documentos"
        ? <DocumentosSection clientId={currentClient.id} />
        : <MensajesSection clientId={currentClient.id} />}
    </div>
  );
}
