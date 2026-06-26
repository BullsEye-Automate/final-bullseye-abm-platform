"use client";

import { useEffect, useState } from "react";
import {
  IconPlus,
  IconTrash,
  IconChevronDown,
  IconLoader2,
  IconCheck,
  IconAlertCircle,
  IconCopy,
} from "@tabler/icons-react";
import {
  IcpFormData,
  EMPTY_FORM,
  IndustrySectionKey,
  INDUSTRY_SECTION_LABELS,
  SECTION_FIELDS,
  TAMANO_OPTS, FACTURACION_OPTS, MODELO_OPTS, ETAPA_OPTS,
  DEPTO_OPTS, SENIORITY_OPTS, TONO_OPTS, IDIOMA_OPTS, CTA_OPTS, CANALES_OPTS,
  serializeSectionForm,
  deserializeIcpForm,
} from "@/lib/icp-form";

type Industry = {
  id: string;
  name: string;
  sort_order: number;
};

type SectionState = {
  form: IcpFormData;
  copyMode: boolean;
  copyFromId: string;
  saving: boolean;
  saved: boolean;
  error: string | null;
};

const ALL_SECTION_KEYS: IndustrySectionKey[] = [
  "target_company",
  "fit_signals",
  "buyer_persona",
  "value_prop",
  "outreach",
  "reference_clients",
];

export default function IndustriesPanel({ clientId }: { clientId: string }) {
  const [industries, setIndustries]       = useState<Industry[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [adding, setAdding]               = useState(false);
  const [newName, setNewName]             = useState("");
  const [savingNew, setSavingNew]         = useState(false);
  const [expandedId, setExpandedId]       = useState<string | null>(null);
  const [deletingId, setDeletingId]       = useState<string | null>(null);
  // Map: industryId → { sectionKey → SectionState }
  const [sectionStates, setSectionStates] = useState<
    Record<string, Record<string, SectionState>>
  >({});

  useEffect(() => {
    loadIndustries();
  }, [clientId]);

  async function loadIndustries() {
    setLoading(true);
    const res = await fetch(`/api/clients/${clientId}/industries`, { cache: "no-store" });
    const j = await res.json();
    setLoading(false);
    if (j.error) { setError(j.error); return; }
    setIndustries(j.industries ?? []);
  }

  async function addIndustry() {
    if (!newName.trim()) return;
    setSavingNew(true);
    const res = await fetch(`/api/clients/${clientId}/industries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const j = await res.json();
    setSavingNew(false);
    if (j.error) { setError(j.error); return; }
    setIndustries((prev) => [...prev, j.industry]);
    setNewName("");
    setAdding(false);
  }

  async function deleteIndustry(id: string) {
    setDeletingId(id);
    const res = await fetch(`/api/clients/${clientId}/industries/${id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) return;
    setIndustries((prev) => prev.filter((i) => i.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  async function expandIndustry(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    // Cargar secciones si no están cargadas
    if (sectionStates[id]) return;
    const res = await fetch(`/api/clients/${clientId}/industries/${id}/sections`, { cache: "no-store" });
    const j = await res.json();
    const loaded: Record<string, SectionState> = {};
    for (const key of ALL_SECTION_KEYS) {
      const stored = j.sections?.[key];
      loaded[key] = {
        form: stored?.content ? deserializeIcpForm(stored.content) : { ...EMPTY_FORM },
        copyMode: false,
        copyFromId: "",
        saving: false,
        saved: false,
        error: null,
      };
    }
    setSectionStates((prev) => ({ ...prev, [id]: loaded }));
  }

  function setSectionField(industryId: string, sectionKey: string, field: keyof IcpFormData, value: string | string[]) {
    setSectionStates((prev) => ({
      ...prev,
      [industryId]: {
        ...prev[industryId],
        [sectionKey]: {
          ...prev[industryId][sectionKey],
          form: { ...prev[industryId][sectionKey].form, [field]: value },
          saved: false,
        },
      },
    }));
  }

  function toggleSectionChip(industryId: string, sectionKey: string, field: keyof IcpFormData, value: string) {
    const current = (sectionStates[industryId]?.[sectionKey]?.form[field] as string[]) ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    setSectionField(industryId, sectionKey, field, next);
  }

  async function copyFromIndustry(industryId: string, sectionKey: string, fromId: string) {
    if (!fromId) return;
    const res = await fetch(`/api/clients/${clientId}/industries/${fromId}/sections`, { cache: "no-store" });
    const j = await res.json();
    const stored = j.sections?.[sectionKey];
    const form = stored?.content ? deserializeIcpForm(stored.content) : { ...EMPTY_FORM };
    setSectionStates((prev) => ({
      ...prev,
      [industryId]: {
        ...prev[industryId],
        [sectionKey]: {
          ...prev[industryId][sectionKey],
          form,
          copyMode: false,
          copyFromId: fromId,
          saved: false,
        },
      },
    }));
  }

  async function saveSection(industryId: string, sectionKey: IndustrySectionKey) {
    const state = sectionStates[industryId]?.[sectionKey];
    if (!state) return;
    setSectionStates((prev) => ({
      ...prev,
      [industryId]: { ...prev[industryId], [sectionKey]: { ...state, saving: true, error: null } },
    }));
    const content = serializeSectionForm(sectionKey, state.form);
    const res = await fetch(`/api/clients/${clientId}/industries/${industryId}/sections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section_key: sectionKey, content, copied_from_industry_id: state.copyFromId || null }),
    });
    const j = await res.json();
    setSectionStates((prev) => ({
      ...prev,
      [industryId]: {
        ...prev[industryId],
        [sectionKey]: { ...state, saving: false, saved: !j.error, error: j.error ?? null },
      },
    }));
    if (!j.error) setTimeout(() => {
      setSectionStates((prev) => ({
        ...prev,
        [industryId]: {
          ...prev[industryId],
          [sectionKey]: { ...prev[industryId][sectionKey], saved: false },
        },
      }));
    }, 2500);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-ink-muted text-sm">
        <IconLoader2 size={16} className="animate-spin" /> Cargando industrias…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 text-sm text-danger-fg">
          <IconAlertCircle size={14} /> {error}
        </div>
      )}

      {industries.length === 0 && !adding && (
        <div className="card text-sm text-ink-muted text-center py-6">
          Todavía no hay industrias configuradas. Haz clic en <strong>+ Agregar industria</strong> para empezar.
        </div>
      )}

      {industries.map((industry) => {
        const isExpanded = expandedId === industry.id;
        const sections   = sectionStates[industry.id];
        const othersForCopy = industries.filter((i) => i.id !== industry.id);

        return (
          <div
            key={industry.id}
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid #E5E2F0" }}
          >
            {/* Cabecera de industria */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ background: "#251762" }}
            >
              <button
                className="flex items-center gap-3 flex-1 text-left"
                onClick={() => expandIndustry(industry.id)}
              >
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{ background: "#62E0D8", color: "#251762" }}
                >
                  {industry.name.charAt(0).toUpperCase()}
                </span>
                <span className="font-semibold text-sm text-white tracking-wide">{industry.name}</span>
                <IconChevronDown
                  size={15}
                  style={{
                    color: "#62E0D8",
                    transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                    transition: "transform 0.2s",
                    marginLeft: "auto",
                  }}
                />
              </button>
              <button
                className="ml-3 p-1 rounded hover:bg-white/10 transition-colors"
                onClick={() => deleteIndustry(industry.id)}
                disabled={deletingId === industry.id}
                title="Eliminar industria"
              >
                {deletingId === industry.id ? (
                  <IconLoader2 size={14} className="animate-spin text-white/50" />
                ) : (
                  <IconTrash size={14} className="text-white/50 hover:text-danger-fg" />
                )}
              </button>
            </div>

            {/* Secciones de la industria */}
            {isExpanded && (
              <div className="p-4 space-y-3">
                {!sections && (
                  <div className="flex items-center gap-2 text-sm text-ink-muted">
                    <IconLoader2 size={14} className="animate-spin" /> Cargando secciones…
                  </div>
                )}
                {sections && ALL_SECTION_KEYS.map((sectionKey) => {
                  const meta  = INDUSTRY_SECTION_LABELS[sectionKey];
                  const state = sections[sectionKey];
                  if (!state) return null;

                  return (
                    <SectionAccordion
                      key={sectionKey}
                      meta={meta}
                      sectionKey={sectionKey}
                      state={state}
                      othersForCopy={othersForCopy}
                      onFieldChange={(field, value) => setSectionField(industry.id, sectionKey, field, value)}
                      onChipToggle={(field, value) => toggleSectionChip(industry.id, sectionKey, field, value)}
                      onCopyModeToggle={() =>
                        setSectionStates((prev) => ({
                          ...prev,
                          [industry.id]: {
                            ...prev[industry.id],
                            [sectionKey]: { ...state, copyMode: !state.copyMode },
                          },
                        }))
                      }
                      onCopyFromIndustry={(fromId) => copyFromIndustry(industry.id, sectionKey, fromId)}
                      onSave={() => saveSection(industry.id, sectionKey)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Agregar nueva industria */}
      {adding ? (
        <div className="card flex items-center gap-2 py-2 px-3">
          <input
            autoFocus
            className="input flex-1"
            placeholder="Nombre de la industria (ej: Financiero, Retail, Salud…)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addIndustry();
              if (e.key === "Escape") { setAdding(false); setNewName(""); }
            }}
          />
          <button
            className="btn-primary py-1.5 px-3 text-sm"
            onClick={addIndustry}
            disabled={savingNew || !newName.trim()}
          >
            {savingNew ? <IconLoader2 size={14} className="animate-spin" /> : <IconCheck size={14} />}
            Agregar
          </button>
          <button
            className="btn-secondary py-1.5 px-3 text-sm"
            onClick={() => { setAdding(false); setNewName(""); }}
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          className="btn-secondary w-full flex items-center justify-center gap-2"
          onClick={() => setAdding(true)}
        >
          <IconPlus size={15} /> Agregar industria
        </button>
      )}
    </div>
  );
}

// ── Acordeón de sección por industria ─────────────────────────────────
function SectionAccordion({
  meta, sectionKey, state, othersForCopy,
  onFieldChange, onChipToggle, onCopyModeToggle, onCopyFromIndustry, onSave,
}: {
  meta: { num: number; title: string; desc: string };
  sectionKey: IndustrySectionKey;
  state: SectionState;
  othersForCopy: Industry[];
  onFieldChange: (field: keyof IcpFormData, value: string | string[]) => void;
  onChipToggle:  (field: keyof IcpFormData, value: string) => void;
  onCopyModeToggle: () => void;
  onCopyFromIndustry: (fromId: string) => void;
  onSave: () => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const f = state.form;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #E5E2F0" }}>
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[rgba(37,23,98,0.02)] transition-colors"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-3">
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
            style={{ background: "rgba(37,23,98,0.1)", color: "#251762" }}
          >
            {meta.num}
          </span>
          <div>
            <div className="font-semibold text-xs text-ink tracking-wide">{meta.title}</div>
            <div className="text-[10px] text-ink-muted mt-0.5">{meta.desc}</div>
          </div>
        </div>
        <IconChevronDown
          size={14}
          style={{
            color: "#9CA3AF",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        />
      </button>

      {!collapsed && (
        <div className="p-4 space-y-4 border-t border-[#F1EEF7]">
          {/* Toggle: configurar / copiar de otra industria */}
          {othersForCopy.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-ink-muted">Origen:</span>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="radio"
                  name={`mode-${sectionKey}`}
                  checked={!state.copyMode}
                  onChange={() => state.copyMode && onCopyModeToggle()}
                  className="accent-[#251762]"
                />
                Configurar aquí
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="radio"
                  name={`mode-${sectionKey}`}
                  checked={state.copyMode}
                  onChange={() => !state.copyMode && onCopyModeToggle()}
                  className="accent-[#251762]"
                />
                Copiar de otra industria
              </label>
              {state.copyMode && (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <select
                    className="input flex-1 text-xs py-1"
                    defaultValue=""
                    onChange={(e) => e.target.value && onCopyFromIndustry(e.target.value)}
                  >
                    <option value="" disabled>Selecciona industria…</option>
                    {othersForCopy.map((ind) => (
                      <option key={ind.id} value={ind.id}>{ind.name}</option>
                    ))}
                  </select>
                  <IconCopy size={13} className="text-ink-muted shrink-0" />
                </div>
              )}
            </div>
          )}

          {/* Campos de la sección */}
          {!state.copyMode && (
            <SectionFields sectionKey={sectionKey} form={f} onFieldChange={onFieldChange} onChipToggle={onChipToggle} />
          )}

          {/* Botón guardar */}
          {!state.copyMode && (
            <div className="flex items-center gap-2 pt-1">
              <button
                className="btn-primary py-1.5 px-3 text-xs"
                onClick={onSave}
                disabled={state.saving}
              >
                {state.saving ? (
                  <IconLoader2 size={13} className="animate-spin" />
                ) : state.saved ? (
                  <IconCheck size={13} />
                ) : null}
                {state.saving ? "Guardando…" : state.saved ? "Guardado" : "Guardar sección"}
              </button>
              {state.error && (
                <span className="text-xs text-danger-fg flex items-center gap-1">
                  <IconAlertCircle size={12} /> {state.error}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Campos por sección ─────────────────────────────────────────────────
function SectionFields({
  sectionKey, form, onFieldChange, onChipToggle,
}: {
  sectionKey: IndustrySectionKey;
  form: IcpFormData;
  onFieldChange: (field: keyof IcpFormData, value: string | string[]) => void;
  onChipToggle:  (field: keyof IcpFormData, value: string) => void;
}) {
  if (sectionKey === "target_company") return (
    <div className="space-y-3">
      <TA label="Industrias objetivo" crit value={form.industrias_objetivo} onChange={(v) => onFieldChange("industrias_objetivo", v)}
        hint="Lista en orden de prioridad" rows={4} placeholder={"1. SaaS B2B con equipo comercial\n2. Fintech\n3. ..."} />
      <TA label="Industrias excluidas" crit value={form.industrias_excluidas} onChange={(v) => onFieldChange("industrias_excluidas", v)}
        hint="Sectores donde NO aplica" rows={3} placeholder={"- Retail B2C\n- Startups pre-revenue"} />
      <div className="grid grid-cols-2 gap-3">
        <CG label="Tamaño (empleados)" options={TAMANO_OPTS}     selected={form.tamano_empresa} onToggle={(v) => onChipToggle("tamano_empresa", v)} multi />
        <CG label="Facturación anual"  options={FACTURACION_OPTS} selected={form.facturacion}    onToggle={(v) => onChipToggle("facturacion",    v)} multi />
      </div>
      <TA label="Geografías prioritarias" crit value={form.geografias} onChange={(v) => onFieldChange("geografias", v)}
        rows={3} placeholder={"1. Chile\n2. México\n3. ..."} />
      <div className="grid grid-cols-2 gap-3">
        <CG label="Modelo de empresa" options={MODELO_OPTS} selected={form.modelo_empresa} onToggle={(v) => onChipToggle("modelo_empresa", v)} multi />
        <CG label="Etapa"             options={ETAPA_OPTS}  selected={form.etapa_empresa}  onToggle={(v) => onChipToggle("etapa_empresa",  v)} multi />
      </div>
    </div>
  );

  if (sectionKey === "fit_signals") return (
    <div className="space-y-3">
      <TA label="Señales positivas de fit" crit value={form.senales_positivas} onChange={(v) => onFieldChange("senales_positivas", v)}
        hint="¿Qué indica que una empresa necesita tu solución?" rows={5}
        placeholder={"1. Tienen equipo de ventas 3+ personas\n2. Usan HubSpot\n3. ..."} />
      <TA label="Señales negativas / descalificadores" crit value={form.senales_negativas} onChange={(v) => onFieldChange("senales_negativas", v)}
        rows={4} placeholder={"1. Solo 1 vendedor\n2. B2C puro\n3. ..."} />
      <TA label="Tech stack que usa el cliente ideal" value={form.tech_stack} onChange={(v) => onFieldChange("tech_stack", v)}
        rows={3} placeholder={"CRM: HubSpot, Salesforce\nAutomatización: Outreach"} />
      <TA label="Eventos disparadores de compra" value={form.eventos_disparadores} onChange={(v) => onFieldChange("eventos_disparadores", v)}
        rows={3} placeholder={"- Expansión a nuevo mercado\n- Ronda de inversión reciente"} />
    </div>
  );

  if (sectionKey === "buyer_persona") return (
    <div className="space-y-3">
      <TA label="Cargos decisores" crit value={form.cargos_decisores} onChange={(v) => onFieldChange("cargos_decisores", v)}
        hint="Quienes aprueban el contrato" rows={3} placeholder={"1. CEO / Founder\n2. VP Ventas\n3. ..."} />
      <TA label="Cargos influenciadores" value={form.cargos_influenciadores} onChange={(v) => onFieldChange("cargos_influenciadores", v)}
        hint="Abren la puerta pero no aprueban" rows={3} placeholder={"1. Sales Manager\n2. Revenue Ops"} />
      <TA label="Cargos a evitar" crit value={form.cargos_evitar} onChange={(v) => onFieldChange("cargos_evitar", v)}
        rows={2} placeholder={"- Pasantes\n- IT sin influencia comercial"} />
      <div className="grid grid-cols-2 gap-3">
        <CG label="Departamentos objetivo" options={DEPTO_OPTS}     selected={form.departamentos} onToggle={(v) => onChipToggle("departamentos", v)} multi />
        <CG label="Seniority mínimo"       options={SENIORITY_OPTS} selected={form.seniority}     onToggle={(v) => onChipToggle("seniority",     v)} multi />
      </div>
      <TA label="Perfil psicográfico del buyer" value={form.perfil_psicografico} onChange={(v) => onFieldChange("perfil_psicografico", v)}
        rows={4} placeholder={"Orientado a métricas, necesita justificar ROI ante el CEO..."} />
    </div>
  );

  if (sectionKey === "value_prop") return (
    <div className="space-y-3">
      <TA label="Propuesta de valor en 1–2 oraciones" crit value={form.propuesta_valor} onChange={(v) => onFieldChange("propuesta_valor", v)}
        rows={3} placeholder={"Ej: Ayudamos a empresas B2B a generar más reuniones calificadas..."} />
      <TA label="Top 3 problemas que resuelves" crit value={form.problemas} onChange={(v) => onFieldChange("problemas", v)}
        rows={4} placeholder={"1. El equipo pierde tiempo en leads no calificados\n2. ..."} />
      <TA label="Top 3 resultados que entregas" value={form.resultados} onChange={(v) => onFieldChange("resultados", v)}
        hint="Con números si los tienes" rows={4} placeholder={"1. +40% reuniones calificadas\n2. Pipeline predecible\n3. ..."} />
      <TA label="Principales competidores" value={form.competidores} onChange={(v) => onFieldChange("competidores", v)}
        rows={3} placeholder={"Directos: Empresa A, B\nIndirectos: Agencias, SDR interno"} />
      <TA label="Por qué te eligen vs. la competencia" value={form.diferenciadores} onChange={(v) => onFieldChange("diferenciadores", v)}
        rows={3} placeholder={"Ej: 'Combinamos estrategia + ejecución. No son solo herramienta.'"} />
    </div>
  );

  if (sectionKey === "outreach") return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <CG label="Tono de comunicación" crit options={TONO_OPTS}   selected={form.tono}   onToggle={(v) => onChipToggle("tono",   v)} />
        <CG label="Idioma del outreach"       options={IDIOMA_OPTS} selected={form.idioma} onToggle={(v) => onChipToggle("idioma", v)} multi />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <CG label="CTA del primer contacto" options={CTA_OPTS}     selected={form.cta_primer_contacto} onToggle={(v) => onChipToggle("cta_primer_contacto", v)} />
        <CG label="Canales preferidos"      options={CANALES_OPTS} selected={form.canales}             onToggle={(v) => onChipToggle("canales",             v)} multi />
      </div>
      <TA label="Mensajes que han funcionado" value={form.mensajes_exitosos} onChange={(v) => onFieldChange("mensajes_exitosos", v)}
        hint="1–2 emails o mensajes LinkedIn con respuesta positiva" rows={6}
        placeholder={"Asunto: [Nombre empresa] + prospección\nHola [Nombre], vi que están contratando SDRs..."} />
      <TA label="Objeciones frecuentes y cómo responderlas" value={form.objeciones} onChange={(v) => onFieldChange("objeciones", v)}
        rows={4} placeholder={"'Ya tenemos agencia' → ...\n'Sin presupuesto' → ..."} />
    </div>
  );

  if (sectionKey === "reference_clients") return (
    <div className="space-y-3">
      <TA label="Top 3–5 mejores clientes actuales o pasados" crit value={form.mejores_clientes} onChange={(v) => onFieldChange("mejores_clientes", v)}
        hint="Nombre/tipo, industria, tamaño, por qué fueron tan buenos" rows={5}
        placeholder={"1. Empresa A — Fintech 80 emp. — compra por ROI, ciclo rápido\n2. ..."} />
      <div className="grid grid-cols-2 gap-3">
        <TA label="Peores clientes / mal fit" value={form.peores_clientes} onChange={(v) => onFieldChange("peores_clientes", v)}
          rows={4} placeholder={"1. Fundador que hace todo solo\n2. Sector muy regulado"} />
        <TA label="Ticket / ACV y ciclo de venta" value={form.ticket_acv} onChange={(v) => onFieldChange("ticket_acv", v)}
          rows={4} placeholder={"Ticket mínimo: $X/mes\nCiclo típico: X semanas"} />
      </div>
    </div>
  );

  return null;
}

// ── Micro-componentes reutilizables ────────────────────────────────────
function TA({
  label, value, onChange, rows = 3, placeholder, hint, crit,
}: {
  label: string; value: string; onChange: (v: string) => void;
  rows?: number; placeholder?: string; hint?: string; crit?: boolean;
}) {
  return (
    <label className="block">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink mb-1">
        {label}
        {crit && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
            style={{ background: "rgba(37,23,98,0.08)", color: "#251762", border: "1px solid rgba(37,23,98,0.15)" }}>
            Crítico
          </span>
        )}
      </div>
      {hint && <div className="text-[11px] text-ink-muted mb-1.5 leading-snug">{hint}</div>}
      <textarea rows={rows} className="input w-full resize-y text-sm"
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function CG({
  label, options, selected, onToggle, multi, crit,
}: {
  label: string; options: string[]; selected: string[];
  onToggle: (v: string) => void; multi?: boolean; crit?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold text-ink mb-2">
        {label}
        {crit && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
            style={{ background: "rgba(37,23,98,0.08)", color: "#251762", border: "1px solid rgba(37,23,98,0.15)" }}>
            Crítico
          </span>
        )}
        {!multi && <span className="text-[10px] text-ink-subtle font-normal">(elige uno)</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button key={opt} type="button" onClick={() => onToggle(opt)}
              className="px-2.5 py-0.5 rounded-full text-xs font-medium transition-all"
              style={active
                ? { background: "#251762", color: "#fff", border: "1.5px solid #251762" }
                : { background: "#F1EEF7", color: "#4A4E6B", border: "1.5px solid transparent" }}>
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
