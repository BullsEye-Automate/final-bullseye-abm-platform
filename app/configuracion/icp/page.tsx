"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconLoader2,
  IconUpload,
  IconDeviceFloppy,
  IconTrash,
  IconCheck,
  IconFileText,
  IconX,
  IconChevronDown,
  IconLayoutList,
  IconCode
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";

// ── Types ──────────────────────────────────────────────────────────────
type IcpDoc = {
  id: string;
  file_name: string;
  file_type: string;
  content: string;
  uploaded_at: string;
};

type FieldDef = {
  key: string;
  label: string;
  rows: number;
  placeholder?: string;
};

type SectionDef = {
  id: string;
  title: string;
  matchKeywords: string[];   // palabras clave para matching flexible
  fields: FieldDef[];
};

type SectionState = {
  def: SectionDef;
  values: Record<string, string>;
  collapsed: boolean;
};

// ── Definición de secciones y campos ──────────────────────────────────
const SECTION_DEFS: SectionDef[] = [
  {
    id: "datos_cliente",
    title: "DATOS DEL CLIENTE",
    matchKeywords: ["datos", "cliente"],
    fields: [
      { key: "nombre_empresa",  label: "Nombre de la empresa",       rows: 1 },
      { key: "contacto",        label: "Nombre del contacto",        rows: 1 },
      { key: "industria",       label: "Industria / Sector",         rows: 1 },
      { key: "descripcion",     label: "Descripción del negocio",    rows: 3 },
      { key: "otros",           label: "Otros datos relevantes",     rows: 2 },
    ],
  },
  {
    id: "perfil_empresa",
    title: "PERFIL DE EMPRESA OBJETIVO",
    matchKeywords: ["perfil", "empresa", "objetivo"],
    fields: [
      { key: "tipo_empresa",  label: "Tipo de empresa objetivo",          rows: 2 },
      { key: "tamano",        label: "Tamaño (empleados / revenue)",      rows: 1 },
      { key: "industrias",    label: "Industrias objetivo",               rows: 2 },
      { key: "geografias",    label: "Geografías prioritarias",           rows: 2 },
      { key: "tecnologias",   label: "Tecnologías / Stack que usa",       rows: 2 },
    ],
  },
  {
    id: "senales_fit",
    title: "SEÑALES DE FIT",
    matchKeywords: ["señal", "fit"],
    fields: [
      { key: "senales_positivas",    label: "Señales positivas de fit",             rows: 4 },
      { key: "senales_negativas",    label: "Señales negativas / descalificadores", rows: 3 },
      { key: "tech_stack",           label: "Tech stack del cliente ideal",          rows: 3 },
      { key: "eventos_disparadores", label: "Eventos disparadores de compra",        rows: 3 },
    ],
  },
  {
    id: "buyer_persona",
    title: "BUYER PERSONA",
    matchKeywords: ["buyer", "persona"],
    fields: [
      { key: "cargos_decisores",       label: "Cargos decisores (quien aprueba)",          rows: 2 },
      { key: "cargos_influenciadores", label: "Cargos influenciadores (quien recomienda)", rows: 2 },
      { key: "cargos_evitar",          label: "Cargos a evitar",                           rows: 2 },
      { key: "departamentos",          label: "Departamentos objetivo",                     rows: 2 },
      { key: "seniority",              label: "Seniority mínimo",                          rows: 1 },
      { key: "psicografico",           label: "Perfil psicográfico",                       rows: 3 },
    ],
  },
  {
    id: "propuesta_valor",
    title: "PROPUESTA DE VALOR",
    matchKeywords: ["propuesta", "valor"],
    fields: [
      { key: "propuesta_core",  label: "Propuesta de valor en 1-2 oraciones",  rows: 3 },
      { key: "problemas",       label: "Top 3 problemas que resuelves",         rows: 3 },
      { key: "resultados",      label: "Top 3 resultados que entregas",         rows: 3 },
      { key: "competidores",    label: "Competidores principales",              rows: 2 },
      { key: "diferenciador",   label: "Por qué te eligen vs competencia",      rows: 3 },
    ],
  },
  {
    id: "outreach_tono",
    title: "OUTREACH Y TONO",
    matchKeywords: ["outreach", "tono"],
    fields: [
      { key: "tono",       label: "Tono de comunicación",                         rows: 2 },
      { key: "canales",    label: "Canales prioritarios",                          rows: 2 },
      { key: "hook",       label: "Mensaje de apertura / hook principal",          rows: 3 },
      { key: "objeciones", label: "Objeciones comunes y cómo responderlas",        rows: 4 },
      { key: "cta",        label: "CTA / llamada a la acción preferida",           rows: 2 },
    ],
  },
  {
    id: "clientes_referencia",
    title: "CLIENTES DE REFERENCIA",
    matchKeywords: ["clientes", "referencia"],
    fields: [
      { key: "clientes_actuales", label: "Clientes actuales de referencia",             rows: 4 },
      { key: "casos_exito",       label: "Casos de éxito / resultados reales",          rows: 4 },
      { key: "patron_comun",      label: "Patrón común entre los mejores clientes",     rows: 3 },
    ],
  },
];

function emptySection(def: SectionDef): SectionState {
  const values: Record<string, string> = {};
  def.fields.forEach((f) => (values[f.key] = ""));
  return { def, values, collapsed: false };
}

// ── Helpers ────────────────────────────────────────────────────────────
function formatBytes(n: number) {
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(1)}k chars`;
}

function normalizeStr(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")  // elimina diacríticos (tildes, ñ→n, etc.)
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Devuelve true si el chunk es un título de sección (todo mayúsculas)
function looksLikeTitle(line: string): boolean {
  const t = line.trim();
  return t.length > 1 && t === t.toUpperCase() && /[A-ZÀ-Ü]/.test(t);
}

// Matching flexible: todos los matchKeywords deben aparecer en el título normalizado
function matchesDef(fileTitle: string, def: SectionDef): boolean {
  const norm = normalizeStr(fileTitle);
  return def.matchKeywords.every((kw) => norm.includes(normalizeStr(kw)));
}

// ── Parser de campos dentro de una sección ────────────────────────────
// Formato estructurado: [Label del campo]\ncontenido\n\n[Siguiente campo]...
// Si no tiene esa estructura, vuelca todo en el primer campo
function parseFieldValues(sectionText: string, fields: FieldDef[]): Record<string, string> {
  const values: Record<string, string> = {};
  fields.forEach((f) => (values[f.key] = ""));

  const FIELD_TAG = /^\[(.+)\]\s*$/m;

  if (FIELD_TAG.test(sectionText)) {
    // Formato estructurado — dividir por [etiqueta]
    const parts = sectionText.split(/^\[(.+)\]\s*$/m);
    // parts = ['prelude', 'label1', 'content1', 'label2', 'content2', ...]
    for (let i = 1; i < parts.length; i += 2) {
      const label = parts[i]?.trim() ?? "";
      const content = parts[i + 1]?.trim() ?? "";
      const field = fields.find(
        (f) => normalizeStr(f.label) === normalizeStr(label)
      );
      if (field) values[field.key] = content;
    }
  } else if (sectionText.trim()) {
    // Texto libre — volcar todo en el primer campo
    values[fields[0].key] = sectionText.trim();
  }

  return values;
}

// ── Parser principal: texto plano → secciones ─────────────────────────
function parseIcp(text: string): SectionState[] {
  if (!text.trim()) return SECTION_DEFS.map(emptySection);

  // Dividir por líneas de 3 o más guiones
  const chunks = text
    .split(/^-{3,}\s*$/m)
    .map((c) => c.trim())
    .filter(Boolean);

  // Emparejar título → contenido siguiente
  const rawSections: { title: string; content: string }[] = [];
  let i = 0;
  while (i < chunks.length) {
    const firstLine = chunks[i].split("\n")[0].trim();
    if (looksLikeTitle(firstLine)) {
      const title = firstLine;
      const next = chunks[i + 1];
      const content =
        next && !looksLikeTitle(next.split("\n")[0].trim()) ? next : "";
      rawSections.push({ title, content });
      i += content ? 2 : 1;
    } else {
      if (rawSections.length > 0) {
        rawSections[rawSections.length - 1].content +=
          "\n\n" + chunks[i];
      }
      i++;
    }
  }

  // Mapear cada sección rawSection → SectionDef por matching flexible
  return SECTION_DEFS.map((def) => {
    const raw = rawSections.find((rs) => matchesDef(rs.title, def));
    const values = raw
      ? parseFieldValues(raw.content, def.fields)
      : Object.fromEntries(def.fields.map((f) => [f.key, ""]));
    return { def, values, collapsed: false };
  });
}

// ── Serializador: secciones → texto plano ─────────────────────────────
function serializeIcp(sections: SectionState[]): string {
  return sections
    .filter((s) => s.def.fields.some((f) => s.values[f.key]?.trim()))
    .map((s) => {
      const sep = "-".repeat(42);
      const fieldsText = s.def.fields
        .filter((f) => s.values[f.key]?.trim())
        .map((f) => `[${f.label}]\n${s.values[f.key].trim()}`)
        .join("\n\n");
      return `${sep}\n${s.def.title}\n${sep}\n\n${fieldsText}`;
    })
    .join("\n\n");
}

// ── Componente principal ───────────────────────────────────────────────
export default function IcpPage() {
  const { currentClient } = useClient();
  const [doc, setDoc]         = useState<IcpDoc | null>(null);
  const [sections, setSections] = useState<SectionState[]>(() =>
    SECTION_DEFS.map(emptySection)
  );
  const [rawText, setRawText] = useState("");
  const [mode, setMode]       = useState<"form" | "text">("form");
  const [fileName, setFileName] = useState("ICP");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [parsing, setParsing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function applyContent(text: string) {
    setRawText(text);
    setSections(parseIcp(text));
  }

  async function load() {
    if (!currentClient) return;
    setLoading(true);
    setError(null);
    const r = await fetch(`/api/clients/${currentClient.id}/context`, {
      cache: "no-store",
    });
    const j = await r.json();
    setLoading(false);
    if (j.error) { setError(j.error); return; }
    const icpDoc: IcpDoc | undefined = (j.items ?? []).find(
      (i: IcpDoc) => i.file_type === "icp"
    );
    setDoc(icpDoc ?? null);
    setFileName(icpDoc?.file_name ?? "ICP");
    setSavedAt(null);
    if (icpDoc?.content) {
      applyContent(icpDoc.content);
    } else {
      setRawText("");
      setSections(SECTION_DEFS.map(emptySection));
    }
  }

  useEffect(() => { load(); }, [currentClient?.id]);

  function switchMode(next: "form" | "text") {
    if (next === "text" && mode === "form") setRawText(serializeIcp(sections));
    if (next === "form" && mode === "text") setSections(parseIcp(rawText));
    setMode(next);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const baseName = file.name.replace(/\.[^.]+$/, "");

    if (ext === "txt" || ext === "md" || ext === "markdown") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        applyContent((ev.target?.result as string) ?? "");
        setFileName(baseName);
        setSavedAt(null);
      };
      reader.readAsText(file, "utf-8");
      return;
    }

    setParsing(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/parse-document", { method: "POST", body: form });
    const j = await r.json();
    setParsing(false);
    if (j.error) { setError(`Error al leer el archivo: ${j.error}`); return; }
    applyContent(j.text ?? "");
    setFileName(baseName);
    setSavedAt(null);
  }

  async function save() {
    if (!currentClient) return;
    const content =
      mode === "form" ? serializeIcp(sections) : rawText;
    if (!content.trim()) return;
    setSaving(true);
    setError(null);

    const r = doc
      ? await fetch(`/api/clients/${currentClient.id}/context/${doc.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_name: fileName, content }),
        })
      : await fetch(`/api/clients/${currentClient.id}/context`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_name: fileName, file_type: "icp", content }),
        });

    const j = await r.json();
    setSaving(false);
    if (j.error) { setError(j.error); return; }
    setDoc(j.item);
    setFileName(j.item.file_name);
    setSavedAt(new Date().toLocaleTimeString());
  }

  async function remove() {
    if (!currentClient || !doc) return;
    setDeleting(true);
    const r = await fetch(
      `/api/clients/${currentClient.id}/context/${doc.id}`,
      { method: "DELETE" }
    );
    setDeleting(false);
    if (r.ok) {
      setDoc(null);
      setRawText("");
      setSections(SECTION_DEFS.map(emptySection));
      setFileName("ICP");
      setSavedAt(null);
    }
  }

  function toggleSection(id: string) {
    setSections((prev) =>
      prev.map((s) =>
        s.def.id === id ? { ...s, collapsed: !s.collapsed } : s
      )
    );
  }

  function updateField(sectionId: string, fieldKey: string, value: string) {
    setSections((prev) =>
      prev.map((s) =>
        s.def.id === sectionId
          ? { ...s, values: { ...s.values, [fieldKey]: value } }
          : s
      )
    );
    setSavedAt(null);
  }

  const hasContent =
    mode === "form"
      ? sections.some((s) =>
          s.def.fields.some((f) => s.values[f.key]?.trim())
        )
      : rawText.trim().length > 0;

  if (!currentClient) {
    return (
      <div className="card flex items-center gap-3 text-warning-fg border border-warning-bg bg-warning-bg/40 text-sm max-w-xl">
        <IconAlertCircle size={18} className="shrink-0" />
        Selecciona un cliente en el sidebar para gestionar su ICP.
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {/* ── Header ── */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="label">Sistema · Configuración</div>
          <h1 className="text-2xl font-semibold tracking-tight">
            ICP — Ideal Customer Profile
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <div
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
              style={{ background: "#251762" }}
            >
              {currentClient.name}
            </div>
            <span className="text-sm text-ink-muted">
              Documento base que el agente IA usa para calificar empresas.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {savedAt && (
            <span className="text-xs text-success-fg flex items-center gap-1">
              <IconCheck size={13} /> Guardado {savedAt}
            </span>
          )}

          {/* Toggle vista */}
          <div
            className="flex rounded-lg overflow-hidden"
            style={{ border: "1px solid #E5E2F0" }}
          >
            <button
              onClick={() => switchMode("form")}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs transition"
              style={{
                background: mode === "form" ? "#251762" : "transparent",
                color: mode === "form" ? "#fff" : undefined,
              }}
            >
              <IconLayoutList size={13} /> Formulario
            </button>
            <button
              onClick={() => switchMode("text")}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs transition"
              style={{
                background: mode === "text" ? "#251762" : "transparent",
                color: mode === "text" ? "#fff" : undefined,
              }}
            >
              <IconCode size={13} /> Texto
            </button>
          </div>

          {doc && (
            <button
              className="btn-secondary py-1.5 px-2 text-danger-fg"
              onClick={remove}
              disabled={deleting}
              title="Eliminar ICP"
            >
              {deleting
                ? <IconLoader2 size={14} className="animate-spin" />
                : <IconTrash size={14} />}
            </button>
          )}

          <button
            className="btn-secondary py-1.5 px-3"
            onClick={() => fileRef.current?.click()}
            disabled={parsing}
          >
            {parsing
              ? <IconLoader2 size={15} className="animate-spin" />
              : <IconUpload size={15} />}
            {parsing ? "Leyendo…" : "Subir archivo"}
          </button>

          <button
            className="btn-primary"
            onClick={save}
            disabled={saving || !hasContent}
          >
            {saving
              ? <IconLoader2 size={15} className="animate-spin" />
              : <IconDeviceFloppy size={15} />}
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </header>

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.markdown,.docx,.doc,.pdf"
        className="hidden"
        onChange={handleFile}
      />

      {error && (
        <div className="card border border-danger-bg text-danger-fg flex items-center gap-2 text-sm">
          <IconAlertCircle size={16} className="shrink-0" /> {error}
          <button className="ml-auto" onClick={() => setError(null)}>
            <IconX size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="card flex items-center gap-3 text-ink-muted">
          <IconLoader2 size={18} className="animate-spin" /> Cargando ICP…
        </div>
      ) : mode === "form" ? (
        // ── Vista formulario ──────────────────────────────────────────
        <div className="space-y-3">
          {/* Nombre */}
          <div className="card py-3">
            <div className="flex items-center gap-3">
              <IconFileText size={15} className="text-ink-subtle shrink-0" />
              <input
                className="input flex-1"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="Nombre del documento ICP"
              />
              {hasContent && (
                <span className="text-xs text-ink-subtle whitespace-nowrap">
                  {formatBytes(serializeIcp(sections).length)}
                </span>
              )}
            </div>
          </div>

          {/* Estado vacío */}
          {!hasContent && (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-[#E5E2F0] rounded-xl p-10 text-center hover:border-brand transition-colors"
            >
              <IconUpload size={28} className="mx-auto mb-2 text-ink-subtle" />
              <p className="font-medium text-ink">
                Sube el archivo ICP del cliente
              </p>
              <p className="text-sm text-ink-muted mt-1">
                .txt · .md · .docx · .pdf — o completa las secciones directamente
              </p>
            </button>
          )}

          {/* Secciones */}
          {sections.map((section) => (
            <SectionBlock
              key={section.def.id}
              section={section}
              onToggle={() => toggleSection(section.def.id)}
              onFieldChange={(key, val) =>
                updateField(section.def.id, key, val)
              }
            />
          ))}

          {doc && (
            <p className="text-xs text-ink-subtle">
              Última actualización:{" "}
              {new Date(doc.uploaded_at).toLocaleDateString("es", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </p>
          )}
        </div>
      ) : (
        // ── Vista texto plano ─────────────────────────────────────────
        <div className="card space-y-4">
          <div className="flex items-center gap-3">
            <IconFileText size={15} className="text-ink-subtle shrink-0" />
            <input
              className="input flex-1"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="Nombre del documento"
            />
            {rawText && (
              <span className="text-xs text-ink-subtle whitespace-nowrap">
                {formatBytes(rawText.length)}
              </span>
            )}
          </div>

          <textarea
            className="input min-h-[560px] font-mono text-xs leading-relaxed"
            placeholder={
              "Pega el contenido del ICP o sube un archivo.\n\n" +
              "Formato esperado:\n" +
              "------------------------------------------\n" +
              "DATOS DEL CLIENTE\n" +
              "------------------------------------------\n" +
              "contenido...\n\n" +
              "------------------------------------------\n" +
              "BUYER PERSONA\n" +
              "------------------------------------------\n" +
              "contenido..."
            }
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value);
              setSavedAt(null);
            }}
          />

          {doc && (
            <p className="text-xs text-ink-subtle">
              Última actualización:{" "}
              {new Date(doc.uploaded_at).toLocaleDateString("es", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Bloque de sección colapsable ───────────────────────────────────────
function SectionBlock({
  section,
  onToggle,
  onFieldChange,
}: {
  section: SectionState;
  onToggle: () => void;
  onFieldChange: (key: string, val: string) => void;
}) {
  const filledCount = section.def.fields.filter(
    (f) => section.values[f.key]?.trim()
  ).length;
  const totalCount = section.def.fields.length;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid #E5E2F0" }}
    >
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        style={{ background: "#251762" }}
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm text-white tracking-wide">
            {section.def.title}
          </span>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{
              background:
                filledCount === totalCount
                  ? "rgba(98,224,216,0.25)"
                  : "rgba(255,255,255,0.12)",
              color: filledCount === totalCount ? "#62E0D8" : "rgba(255,255,255,0.5)",
            }}
          >
            {filledCount}/{totalCount} campos
          </span>
        </div>
        <IconChevronDown
          size={16}
          style={{
            color: "#62E0D8",
            transform: section.collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        />
      </button>

      {/* Campos */}
      {!section.collapsed && (
        <div className="divide-y divide-[#F0EDF8]">
          {section.def.fields.map((field) => (
            <div key={field.key} className="px-5 py-4">
              <label
                className="block text-xs font-semibold text-ink mb-1.5"
                style={{ letterSpacing: "0.01em" }}
              >
                {field.label}
              </label>
              <textarea
                rows={field.rows}
                className="w-full rounded-lg px-3 py-2 text-sm leading-relaxed resize-y outline-none transition-colors"
                style={{
                  background: "#FAFAF9",
                  border: "1px solid #E5E2F0",
                  color: "#1a1a2e",
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = "#62E0D8")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = "#E5E2F0")
                }
                placeholder={
                  field.placeholder ?? `${field.label.toLowerCase()}…`
                }
                value={section.values[field.key] ?? ""}
                onChange={(e) => onFieldChange(field.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
