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
  IconX,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";

// ── Tipos ─────────────────────────────────────────────────────────────
type ContextItem = {
  id: string;
  file_name: string;
  file_type: string;
  content: string;
  uploaded_at: string;
};

type ModelConfig = {
  business_description: string;
  target_buyer_persona: string;
  value_props: string;
  talking_points: string;
  strong_decision_maker_keywords: string[];
  exclude_role_keywords: string[];
};

const EMPTY_CONFIG: ModelConfig = {
  business_description: "",
  target_buyer_persona: "",
  value_props: "",
  talking_points: "",
  strong_decision_maker_keywords: [],
  exclude_role_keywords: [],
};

// ── Constantes docs ────────────────────────────────────────────────────
const FILE_TYPES = [
  { value: "icp",          label: "ICP" },
  { value: "one_pager",    label: "One Pager" },
  { value: "presentacion", label: "Presentación" },
  { value: "caso_uso",     label: "Caso de uso" },
  { value: "propuesta",    label: "Propuesta" },
  { value: "otro",         label: "Otro" },
];

const TYPE_COLORS: Record<string, string> = {
  icp:          "bg-brand-tint text-brand",
  one_pager:    "bg-info-bg text-info-fg",
  presentacion: "bg-warning-bg text-warning-fg",
  caso_uso:     "bg-success-bg text-success-fg",
  propuesta:    "bg-[#F1EEF7] text-ink-muted",
  otro:         "bg-[#F1EEF7] text-ink-subtle",
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
    day: "2-digit", month: "short", year: "numeric",
  });
}

type FormState = { file_name: string; file_type: string; content: string };
const EMPTY_FORM: FormState = { file_name: "", file_type: "icp", content: "" };

// ── Tab Documentos IA ─────────────────────────────────────────────────
function DocumentosTab({ clientId }: { clientId: string }) {
  const [items, setItems]         = useState<ContextItem[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const r = await fetch(`/api/clients/${clientId}/context`, { cache: "no-store" });
    const j = await r.json();
    setLoading(false);
    if (j.error) { setError(j.error); return; }
    setItems(j.items ?? []);
  }

  useEffect(() => {
    load();
    setShowForm(false);
  }, [clientId]);

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
    e.target.value = "";
  }

  async function save() {
    setSaving(true);
    setFormError(null);
    const r = await fetch(`/api/clients/${clientId}/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = await r.json();
    setSaving(false);
    if (j.error) { setFormError(j.error); return; }
    setItems((prev) => [j.item, ...prev]);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  async function remove(item: ContextItem) {
    setDeletingId(item.id);
    const r = await fetch(`/api/clients/${clientId}/context/${item.id}`, { method: "DELETE" });
    setDeletingId(null);
    if (r.ok) {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      if (expandedId === item.id) setExpandedId(null);
    }
  }

  const totalChars = items.reduce((acc, i) => acc + (i.content?.length ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* Resumen + botón */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm text-ink-muted">
          {items.length > 0 && (
            <>
              <span className="flex items-center gap-1.5">
                <IconFileText size={14} />
                {items.length} documento{items.length !== 1 ? "s" : ""}
              </span>
              <span className="flex items-center gap-1.5">
                <IconBrain size={14} />
                {formatBytes(totalChars)} de contexto
              </span>
            </>
          )}
        </div>
        <button
          className="btn-primary"
          onClick={() => { setShowForm(true); setFormError(null); setForm(EMPTY_FORM); }}
          disabled={showForm}
        >
          <IconPlus size={16} /> Agregar documento
        </button>
      </div>

      {/* Formulario */}
      {showForm && (
        <div className="card border-2 space-y-4" style={{ borderColor: "#62E0D8" }}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <IconBrain size={18} style={{ color: "#62E0D8" }} />
              Nuevo documento de contexto
            </h2>
            <button className="btn-secondary py-1 px-2" onClick={() => setShowForm(false)}>
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
              placeholder={"Pega aquí el contenido del documento:\n- ICP completo\n- One pager de propuesta de valor\n- Casos de uso exitosos\n- Cualquier contexto que el agente IA deba conocer"}
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            />
            {form.content && (
              <p className="text-xs text-ink-subtle mt-1 text-right">{formatBytes(form.content.length)}</p>
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
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {error && (
        <div className="card text-danger-fg flex items-center gap-2 text-sm">
          <IconAlertCircle size={16} /> {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && !showForm && (
        <div className="card text-center py-10">
          <IconBrain size={36} className="mx-auto mb-3 text-ink-subtle" />
          <p className="font-medium text-ink">Sin documentos de contexto todavía</p>
          <p className="text-sm text-ink-muted mt-1 max-w-sm mx-auto">
            Agrega el ICP, one pager, propuesta de valor o cualquier documento que el agente deba conocer.
          </p>
          <button
            className="btn-primary mt-4 mx-auto"
            onClick={() => { setShowForm(true); setFormError(null); setForm(EMPTY_FORM); }}
          >
            <IconPlus size={16} /> Agregar primer documento
          </button>
        </div>
      )}

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

// ── Tab Configuración IA ───────────────────────────────────────────────
function ConfiguracionTab({ clientId }: { clientId: string }) {
  const [config, setConfig]   = useState<ModelConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Keywords como texto (una por línea)
  const [strongKw, setStrongKw]   = useState("");
  const [excludeKw, setExcludeKw] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    const r = await fetch(`/api/clients/${clientId}/model-config`, { cache: "no-store" });
    const j = await r.json();
    setLoading(false);
    if (j.error) { setError(j.error); return; }
    if (j.config) {
      setConfig({
        business_description:           j.config.business_description ?? "",
        target_buyer_persona:           j.config.target_buyer_persona ?? "",
        value_props:                    j.config.value_props ?? "",
        talking_points:                 j.config.talking_points ?? "",
        strong_decision_maker_keywords: j.config.strong_decision_maker_keywords ?? [],
        exclude_role_keywords:          j.config.exclude_role_keywords ?? [],
      });
      setStrongKw((j.config.strong_decision_maker_keywords ?? []).join("\n"));
      setExcludeKw((j.config.exclude_role_keywords ?? []).join("\n"));
    }
  }

  useEffect(() => { load(); }, [clientId]);

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      ...config,
      strong_decision_maker_keywords: strongKw.split("\n").map((k) => k.trim()).filter(Boolean),
      exclude_role_keywords:          excludeKw.split("\n").map((k) => k.trim()).filter(Boolean),
    };
    const r = await fetch(`/api/clients/${clientId}/model-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    setSaving(false);
    if (j.error) { setError(j.error); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) {
    return (
      <div className="card flex items-center gap-3 text-ink-muted">
        <IconLoader2 size={18} className="animate-spin" /> Cargando configuración…
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {error && (
        <div className="card text-danger-fg flex items-center gap-2 text-sm">
          <IconAlertCircle size={16} /> {error}
        </div>
      )}

      <p className="text-sm text-ink-muted">
        Esta información alimenta los prompts del agente IA para scoring de contactos y generación de mensajes.
      </p>

      {/* Descripción del negocio */}
      <div className="card space-y-2">
        <div>
          <label className="text-xs font-semibold text-ink block mb-0.5">Descripción del negocio</label>
          <p className="text-[11px] text-ink-muted mb-2">¿Qué hace el cliente? ¿A quién ayuda? ¿Cuál es su diferencial?</p>
          <textarea
            rows={4}
            className="input w-full resize-y"
            placeholder="Ej: BullsEye ABM ayuda a empresas B2B de venta consultiva a generar reuniones calificadas con cuentas objetivo mediante ABM..."
            value={config.business_description}
            onChange={(e) => setConfig((c) => ({ ...c, business_description: e.target.value }))}
          />
        </div>
      </div>

      {/* Perfil del decisor */}
      <div className="card space-y-2">
        <div>
          <label className="text-xs font-semibold text-ink block mb-0.5">Perfil del decisor objetivo</label>
          <p className="text-[11px] text-ink-muted mb-2">Cargo, tamaño de empresa, señales que buscan, dolores típicos.</p>
          <textarea
            rows={4}
            className="input w-full resize-y"
            placeholder="Ej: Director Comercial o CEO en empresas B2B de 15-200 empleados que venden servicios de alto valor..."
            value={config.target_buyer_persona}
            onChange={(e) => setConfig((c) => ({ ...c, target_buyer_persona: e.target.value }))}
          />
        </div>
      </div>

      {/* Propuestas de valor */}
      <div className="card space-y-2">
        <div>
          <label className="text-xs font-semibold text-ink block mb-0.5">Propuestas de valor</label>
          <p className="text-[11px] text-ink-muted mb-2">Una propuesta por línea. El agente las usa para personalizar mensajes.</p>
          <textarea
            rows={5}
            className="input w-full resize-y"
            placeholder={"Generamos reuniones calificadas con cuentas objetivo\nEstrategia ABM personalizada por vertical\nProspección omnicanal (email + LinkedIn)\nContactos pre-investigados con señales de fit"}
            value={config.value_props}
            onChange={(e) => setConfig((c) => ({ ...c, value_props: e.target.value }))}
          />
        </div>
      </div>

      {/* Talking points */}
      <div className="card space-y-2">
        <div>
          <label className="text-xs font-semibold text-ink block mb-0.5">Talking points clave</label>
          <p className="text-[11px] text-ink-muted mb-2">Puntos de conversación que el agente puede usar en icebreakers y follow-ups.</p>
          <textarea
            rows={5}
            className="input w-full resize-y"
            placeholder={"Uno por línea. Ej:\nNo vendemos volumen, vendemos cuentas estratégicas\nTu SDR necesita pipelines, no listas frías\nCada mensaje es personalizado con contexto real de la empresa"}
            value={config.talking_points}
            onChange={(e) => setConfig((c) => ({ ...c, talking_points: e.target.value }))}
          />
        </div>
      </div>

      {/* Keywords scoring */}
      <div className="card space-y-4">
        <h3 className="font-semibold text-sm text-ink flex items-center gap-2">
          <IconBrain size={16} style={{ color: "#62E0D8" }} />
          Scoring de roles
        </h3>
        <p className="text-[11px] text-ink-muted -mt-2">
          El agente de scoring usa estas listas para calificar contactos. Una keyword por línea.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-ink block mb-0.5">Roles decisores ✓</label>
            <p className="text-[11px] text-ink-muted mb-2">Contactos con estos roles suben en el score.</p>
            <textarea
              rows={6}
              className="input w-full resize-y font-mono text-xs"
              placeholder={"CEO\nDirector\nVP\nHead of\nGerente\nOwner\nFounder"}
              value={strongKw}
              onChange={(e) => setStrongKw(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink block mb-0.5">Roles a excluir ✗</label>
            <p className="text-[11px] text-ink-muted mb-2">Contactos con estos roles bajan en el score.</p>
            <textarea
              rows={6}
              className="input w-full resize-y font-mono text-xs"
              placeholder={"Intern\nTrainee\nJunior\nAssistant\nCoordinator\nStaff"}
              value={excludeKw}
              onChange={(e) => setExcludeKw(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Guardar */}
      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          onClick={save}
          disabled={saving}
        >
          {saving
            ? <><IconLoader2 size={15} className="animate-spin" /> Guardando…</>
            : <><IconDeviceFloppy size={15} /> Guardar configuración</>}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-success-fg">
            <IconCheck size={14} /> Guardado
          </span>
        )}
      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────
type Tab = "documentos" | "configuracion";

export default function EntrenarModeloPage() {
  const { currentClient } = useClient();
  const [activeTab, setActiveTab] = useState<Tab>("documentos");

  if (!currentClient) {
    return (
      <div className="card flex items-center gap-3 text-warning-fg border border-warning-bg bg-warning-bg/40 text-sm max-w-xl">
        <IconAlertCircle size={18} className="shrink-0" />
        Selecciona un cliente en el sidebar para gestionar su configuración IA.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <header>
        <div className="label">Análisis · Configuración</div>
        <h1 className="text-2xl font-semibold tracking-tight">Entrenar modelo</h1>
        <div className="flex items-center gap-2 mt-1">
          <div
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
            style={{ background: "#251762" }}
          >
            {currentClient.name}
          </div>
          <span className="text-sm text-ink-muted">
            Documentos y configuración que el agente IA usa para prospectar.
          </span>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-[#E5E2F0]">
        <div className="flex gap-1">
          {(["documentos", "configuracion"] as Tab[]).map((tab) => {
            const labels: Record<Tab, string> = {
              documentos:    "Documentos IA",
              configuracion: "Configuración IA",
            };
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-4 py-2.5 text-sm font-medium transition-colors -mb-px"
                style={
                  active
                    ? { color: "#251762", borderBottom: "2px solid #62E0D8" }
                    : { color: "#6B6884", borderBottom: "2px solid transparent" }
                }
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Contenido del tab activo */}
      {activeTab === "documentos" && (
        <DocumentosTab clientId={currentClient.id} />
      )}
      {activeTab === "configuracion" && (
        <ConfiguracionTab clientId={currentClient.id} />
      )}
    </div>
  );
}
