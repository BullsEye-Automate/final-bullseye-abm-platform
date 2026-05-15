"use client";

// Entrenar modelo — editor de la config del messageGenerator.
//
// Permite al equipo iterar el tono, talking points por rol/segmento,
// frases prohibidas, propuestas de valor y notas adicionales sin
// tocar código. Preview en vivo con un contacto sample.
//
// Principio: si los campos quedan en blanco, el messageGenerator
// usa los defaults hardcodeados (comportamiento idéntico al original).

import { useCallback, useEffect, useState } from "react";
import {
  IconAlertCircle,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconPlus,
  IconArrowUp,
  IconArrowDown
} from "@tabler/icons-react";

type TalkingPoint = { role: string; company_type: string; points: string };

type FormState = {
  language: string;
  register: string;
  icebreaker_max_chars: string;
  subject_max_words: string;
  body_max_words: string;
  forbidden_phrases: string[];
  required_phrases: string[];
  talking_points: TalkingPoint[];
  value_props: string[];
  notes: string;
};

const EMPTY_FORM: FormState = {
  language: "",
  register: "",
  icebreaker_max_chars: "",
  subject_max_words: "",
  body_max_words: "",
  forbidden_phrases: [],
  required_phrases: [],
  talking_points: [],
  value_props: [],
  notes: ""
};

const ROLE_OPTIONS = [
  "any",
  "Lab Manager",
  "Lab Owner",
  "Operations Manager",
  "Production Manager",
  "CAD Technician",
  "CAD Designer",
  "Owner",
  "Founder",
  "CEO",
  "Director of Operations",
  "Regional Manager"
];

const COMPANY_TYPE_OPTIONS = [
  { value: "any", label: "Cualquier tipo" },
  { value: "lab", label: "Laboratorio dental" },
  { value: "multi_clinic", label: "Multi-clínica" },
  { value: "dso", label: "DSO" }
];

export default function EntrenarModeloPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/model-training", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo cargar la configuración");
        return;
      }
      const c = data.config;
      if (c) {
        setForm({
          language: c.language ?? "",
          register: c.register ?? "",
          icebreaker_max_chars: c.icebreaker_max_chars?.toString() ?? "",
          subject_max_words: c.subject_max_words?.toString() ?? "",
          body_max_words: c.body_max_words?.toString() ?? "",
          forbidden_phrases: c.forbidden_phrases ?? [],
          required_phrases: c.required_phrases ?? [],
          talking_points: c.talking_points ?? [],
          value_props: c.value_props ?? [],
          notes: c.notes ?? ""
        });
        setSavedAt(c.updated_at);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        language: form.language || null,
        register: form.register || null,
        icebreaker_max_chars: form.icebreaker_max_chars
          ? parseInt(form.icebreaker_max_chars, 10)
          : null,
        subject_max_words: form.subject_max_words
          ? parseInt(form.subject_max_words, 10)
          : null,
        body_max_words: form.body_max_words ? parseInt(form.body_max_words, 10) : null,
        forbidden_phrases: form.forbidden_phrases.filter((s) => s.trim()),
        required_phrases: form.required_phrases.filter((s) => s.trim()),
        talking_points: form.talking_points.filter((t) => t.points.trim()),
        value_props: form.value_props.filter((s) => s.trim()),
        notes: form.notes.trim() || null
      };
      const res = await fetch("/api/model-training", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setSavedAt(data.config?.updated_at ?? new Date().toISOString());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="label">Análisis</div>
          <h1 className="text-2xl font-semibold tracking-tight">Entrenar modelo</h1>
          <p className="text-sm text-ink-muted mt-1 max-w-2xl">
            Configura tono, talking points por rol y frases prohibidas para los
            mensajes que genera la IA. Lo que dejes en blanco usa los defaults
            actuales — no se rompe nada.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-secondary">
          <IconRefresh size={16} /> {loading ? "Cargando…" : "Refrescar"}
        </button>
      </header>

      {error && (
        <div className="card bg-danger-bg text-danger-fg flex items-start gap-2 text-sm">
          <IconAlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* ─────── Card 1: Tono y voz ─────── */}
      <section className="card space-y-4">
        <div className="flex items-center gap-2 text-brand">
          <IconBrain size={16} />
          <h2 className="text-sm font-semibold text-ink">Tono y voz</h2>
        </div>
        <p className="text-xs text-ink-muted">
          Configuración global del estilo. En blanco = se usa el default actual
          (inglés, peer industry, 180 chars de icebreaker, 7 palabras de subject).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select
            label="Idioma del mensaje"
            value={form.language}
            onChange={(v) => setForm({ ...form, language: v })}
            options={[
              { value: "", label: "(default: inglés)" },
              { value: "en", label: "Inglés" },
              { value: "es", label: "Español (LATAM)" },
              { value: "mix", label: "Mix (adapta por perfil)" }
            ]}
          />
          <Select
            label="Registro / tono"
            value={form.register}
            onChange={(v) => setForm({ ...form, register: v })}
            options={[
              { value: "", label: "(default: peer industry)" },
              { value: "formal", label: "Formal (C-level, DSO)" },
              { value: "casual", label: "Casual" },
              { value: "peer_industry", label: "Peer del rubro dental" }
            ]}
          />
          <NumberInput
            label="Icebreaker · max caracteres"
            value={form.icebreaker_max_chars}
            placeholder="180 (default)"
            min={50}
            max={500}
            onChange={(v) => setForm({ ...form, icebreaker_max_chars: v })}
          />
          <NumberInput
            label="Subject · max palabras"
            value={form.subject_max_words}
            placeholder="7 (default)"
            min={2}
            max={20}
            onChange={(v) => setForm({ ...form, subject_max_words: v })}
          />
          <NumberInput
            label="Email body · max palabras"
            value={form.body_max_words}
            placeholder="(sin tope por default)"
            min={20}
            max={400}
            onChange={(v) => setForm({ ...form, body_max_words: v })}
          />
        </div>
        <div>
          <ListEditor
            label="Frases prohibidas (una por línea)"
            placeholder='Ej: "game changer", "leverage", "synergy"…'
            items={form.forbidden_phrases}
            onChange={(items) => setForm({ ...form, forbidden_phrases: items })}
            hint="La IA evita usar estas palabras. Si igual se cuelan, se strippean del output."
          />
        </div>
        <div>
          <ListEditor
            label="Frases / términos preferidos (opcional)"
            placeholder='Ej: "24h turnaround", "exocad/inLab"…'
            items={form.required_phrases}
            onChange={(items) => setForm({ ...form, required_phrases: items })}
            hint="La IA prefiere usar este fraseo cuando es relevante. No fuerza inclusión obligatoria."
          />
        </div>
      </section>

      {/* ─────── Card 2: Talking points por rol/segmento ─────── */}
      <section className="card space-y-4">
        <div className="flex items-center gap-2 text-brand">
          <IconBrain size={16} />
          <h2 className="text-sm font-semibold text-ink">
            Talking points por rol / segmento
          </h2>
        </div>
        <p className="text-xs text-ink-muted">
          Guidelines específicos por combinación de rol × tipo de empresa. La
          IA inyecta los talking points que matcheen con el contacto al que le
          está escribiendo. "any" funciona como fallback.
        </p>
        <div className="space-y-3">
          {form.talking_points.map((tp, idx) => (
            <div key={idx} className="border border-divider rounded-md p-3 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <SelectAllowingCustom
                  label="Rol"
                  value={tp.role}
                  options={ROLE_OPTIONS}
                  onChange={(v) => {
                    const next = [...form.talking_points];
                    next[idx] = { ...tp, role: v };
                    setForm({ ...form, talking_points: next });
                  }}
                />
                <Select
                  label="Tipo de empresa"
                  value={tp.company_type}
                  onChange={(v) => {
                    const next = [...form.talking_points];
                    next[idx] = { ...tp, company_type: v };
                    setForm({ ...form, talking_points: next });
                  }}
                  options={COMPANY_TYPE_OPTIONS}
                />
              </div>
              <textarea
                value={tp.points}
                onChange={(e) => {
                  const next = [...form.talking_points];
                  next[idx] = { ...tp, points: e.target.value };
                  setForm({ ...form, talking_points: next });
                }}
                rows={3}
                placeholder="Ej: Hablar de costo/calidad vs hiring de designer. La pregunta clave: ¿cómo manejan picos de volumen?"
                className="w-full text-sm border border-divider rounded-md px-2 py-1.5"
              />
              <button
                onClick={() => {
                  const next = form.talking_points.filter((_, i) => i !== idx);
                  setForm({ ...form, talking_points: next });
                }}
                className="text-xs text-ink-muted hover:text-danger-fg inline-flex items-center gap-1"
              >
                <IconTrash size={12} /> Eliminar
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              setForm({
                ...form,
                talking_points: [
                  ...form.talking_points,
                  { role: "any", company_type: "any", points: "" }
                ]
              });
            }}
            className="btn-secondary text-xs"
          >
            <IconPlus size={14} /> Agregar talking point
          </button>
        </div>
      </section>

      {/* ─────── Card 3: Propuesta de valor ─────── */}
      <section className="card space-y-4">
        <div className="flex items-center gap-2 text-brand">
          <IconBrain size={16} />
          <h2 className="text-sm font-semibold text-ink">
            Propuesta de valor (orden = prioridad)
          </h2>
        </div>
        <p className="text-xs text-ink-muted">
          Lista de value props de weCAD4you en orden de prioridad. La IA usa el
          orden para elegir cuál mencionar primero. Si dejás la lista vacía,
          usa las 5 default (24h turnaround, exocad/inLab, 98.9% sin ajustes,
          scanner-agnostic, scale sin hiring).
        </p>
        <OrderedListEditor
          items={form.value_props}
          onChange={(items) => setForm({ ...form, value_props: items })}
          placeholder="Ej: 24h turnaround vs 3-5 días de la competencia"
        />
      </section>

      {/* ─────── Card 4: Notas adicionales ─────── */}
      <section className="card space-y-3">
        <div className="flex items-center gap-2 text-brand">
          <IconBrain size={16} />
          <h2 className="text-sm font-semibold text-ink">Notas adicionales</h2>
        </div>
        <p className="text-xs text-ink-muted">
          Cualquier instrucción extra que no entre en las categorías de arriba.
          Se inyecta al final del prompt de la IA. Ej: "Cuando hablamos a un
          DSO, siempre mencionar nuestras certificaciones ISO antes que el
          precio."
        </p>
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={4}
          className="w-full text-sm border border-divider rounded-md px-3 py-2"
          placeholder="(opcional)"
        />
      </section>

      <div className="sticky bottom-4 z-10">
        <div className="card flex items-center justify-between bg-white shadow-card">
          <div className="text-xs text-ink-muted">
            {savedAt
              ? `Última actualización: ${new Date(savedAt).toLocaleString("es")}`
              : "Sin guardar"}
          </div>
          <button onClick={save} disabled={saving} className="btn-primary">
            <IconCheck size={14} />
            {saving ? "Guardando…" : "Guardar configuración"}
          </button>
        </div>
      </div>

      {/* ─────── Card 5: Preview en vivo ─────── */}
      <PreviewSection form={form} />
    </div>
  );
}

// ============================================================================
// Inputs reutilizables
// ============================================================================

function Select({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <div className="text-xs text-ink-muted mb-1">{label}</div>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none w-full pl-3 pr-8 py-1.5 border border-divider rounded-md text-sm bg-white text-ink"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <IconChevronDown
          size={14}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"
        />
      </div>
    </label>
  );
}

function SelectAllowingCustom({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const isPreset = options.includes(value);
  const [showCustom, setShowCustom] = useState(!isPreset && value !== "");
  return (
    <label className="block">
      <div className="text-xs text-ink-muted mb-1">{label}</div>
      {showCustom ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Custom (ej: Sales Director)"
            className="flex-1 px-2 py-1.5 border border-divider rounded-md text-sm"
          />
          <button
            type="button"
            onClick={() => {
              setShowCustom(false);
              onChange("any");
            }}
            className="text-xs text-ink-muted hover:text-ink"
          >
            Volver al dropdown
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <select
              value={value}
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  setShowCustom(true);
                  onChange("");
                } else {
                  onChange(e.target.value);
                }
              }}
              className="appearance-none w-full pl-3 pr-8 py-1.5 border border-divider rounded-md text-sm bg-white text-ink"
            >
              {options.map((o) => (
                <option key={o} value={o}>
                  {o === "any" ? "Cualquier rol (fallback)" : o}
                </option>
              ))}
              <option value="__custom__">+ Rol personalizado</option>
            </select>
            <IconChevronDown
              size={14}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"
            />
          </div>
        </div>
      )}
    </label>
  );
}

function NumberInput({
  label,
  value,
  placeholder,
  min,
  max,
  onChange
}: {
  label: string;
  value: string;
  placeholder?: string;
  min: number;
  max: number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <div className="text-xs text-ink-muted mb-1">{label}</div>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 border border-divider rounded-md text-sm"
      />
    </label>
  );
}

function ListEditor({
  label,
  placeholder,
  items,
  onChange,
  hint
}: {
  label: string;
  placeholder?: string;
  items: string[];
  onChange: (v: string[]) => void;
  hint?: string;
}) {
  const text = items.join("\n");
  return (
    <div>
      <div className="text-xs text-ink-muted mb-1">{label}</div>
      <textarea
        rows={4}
        value={text}
        onChange={(e) => onChange(e.target.value.split("\n"))}
        placeholder={placeholder}
        className="w-full text-sm border border-divider rounded-md px-3 py-2"
      />
      {hint && (
        <div className="text-[10px] text-ink-subtle leading-tight mt-1">{hint}</div>
      )}
    </div>
  );
}

function OrderedListEditor({
  items,
  onChange,
  placeholder
}: {
  items: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  function update(idx: number, v: string) {
    const next = [...items];
    next[idx] = v;
    onChange(next);
  }
  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }
  return (
    <div className="space-y-2">
      {items.map((it, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <span className="text-xs text-ink-subtle tabular-nums w-5">{idx + 1}.</span>
          <input
            type="text"
            value={it}
            onChange={(e) => update(idx, e.target.value)}
            className="flex-1 px-2 py-1.5 border border-divider rounded-md text-sm"
          />
          <button
            onClick={() => move(idx, -1)}
            disabled={idx === 0}
            className="text-ink-muted hover:text-ink disabled:opacity-30"
            title="Mover arriba"
          >
            <IconArrowUp size={14} />
          </button>
          <button
            onClick={() => move(idx, 1)}
            disabled={idx === items.length - 1}
            className="text-ink-muted hover:text-ink disabled:opacity-30"
            title="Mover abajo"
          >
            <IconArrowDown size={14} />
          </button>
          <button
            onClick={() => remove(idx)}
            className="text-ink-muted hover:text-danger-fg"
            title="Eliminar"
          >
            <IconTrash size={14} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...items, ""])}
        className="btn-secondary text-xs"
      >
        <IconPlus size={14} /> Agregar
      </button>
    </div>
  );
}

// ============================================================================
// Preview section
// ============================================================================

function PreviewSection({ form }: { form: FormState }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    linkedin_icebreaker: string;
    email_subject: string;
    email_body: string;
    model_used: string;
  } | null>(null);
  const [usedInput, setUsedInput] = useState<Record<string, unknown> | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body = {
        config: {
          language: form.language || null,
          register: form.register || null,
          icebreaker_max_chars: form.icebreaker_max_chars
            ? parseInt(form.icebreaker_max_chars, 10)
            : null,
          subject_max_words: form.subject_max_words
            ? parseInt(form.subject_max_words, 10)
            : null,
          body_max_words: form.body_max_words
            ? parseInt(form.body_max_words, 10)
            : null,
          forbidden_phrases: form.forbidden_phrases.filter((s) => s.trim()),
          required_phrases: form.required_phrases.filter((s) => s.trim()),
          talking_points: form.talking_points.filter((t) => t.points.trim()),
          value_props: form.value_props.filter((s) => s.trim()),
          notes: form.notes.trim() || null
        }
      };
      const res = await fetch("/api/model-training/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setError(data.error ?? `HTTP ${res.status}`);
        if (data.input) setUsedInput(data.input);
      } else {
        setResult(data.result);
        setUsedInput(data.input);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-brand">
          <IconSparkles size={16} />
          <h2 className="text-sm font-semibold text-ink">Preview en vivo</h2>
        </div>
        <button onClick={run} disabled={loading} className="btn-primary">
          <IconSparkles size={14} />
          {loading ? "Generando…" : "Generar ejemplo"}
        </button>
      </div>
      <p className="text-xs text-ink-muted">
        Prueba la configuración actual (lo que está editado pero no
        guardado) sobre un contacto sample. Usa Sarah Johnson, Lab Manager
        en Bright Dental Lab con exocad confirmado. Útil para iterar el
        tono sin afectar a contactos reales.
      </p>
      {error && (
        <div className="text-xs text-danger-fg flex items-start gap-2">
          <IconAlertCircle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {result && (
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="label">LinkedIn icebreaker</div>
            <div className="border border-divider rounded-md p-3 text-sm bg-[#FAFAFE]">
              {result.linkedin_icebreaker}
            </div>
            <div className="text-[10px] text-ink-subtle">
              {result.linkedin_icebreaker.length} caracteres
            </div>
          </div>
          <div className="space-y-1">
            <div className="label">Email subject</div>
            <div className="border border-divider rounded-md p-3 text-sm bg-[#FAFAFE]">
              {result.email_subject}
            </div>
          </div>
          <div className="space-y-1">
            <div className="label">Email body</div>
            <div className="border border-divider rounded-md p-3 text-sm bg-[#FAFAFE] whitespace-pre-wrap">
              {result.email_body}
            </div>
          </div>
          <div className="text-[10px] text-ink-subtle">
            Modelo usado: {result.model_used}
            {usedInput && (
              <>
                {" "} · Contacto: {(usedInput as any).first_name}{" "}
                {(usedInput as any).last_name} · {(usedInput as any).job_title}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
