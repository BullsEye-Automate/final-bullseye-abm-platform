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

type Section = {
  id: string;
  title: string;
  content: string;
  collapsed: boolean;
};

// ── Canonical sections (orden fijo) ───────────────────────────────────
const KNOWN_SECTIONS: { id: string; title: string }[] = [
  { id: "datos_cliente",       title: "DATOS DEL CLIENTE" },
  { id: "perfil_empresa",      title: "PERFIL DE EMPRESA OBJETIVO" },
  { id: "senales_fit",         title: "SEÑALES DE FIT" },
  { id: "buyer_persona",       title: "BUYER PERSONA" },
  { id: "propuesta_valor",     title: "PROPUESTA DE VALOR" },
  { id: "outreach_tono",       title: "OUTREACH Y TONO" },
  { id: "clientes_referencia", title: "CLIENTES DE REFERENCIA" },
];

function emptySection(ks: { id: string; title: string }): Section {
  return { ...ks, content: "", collapsed: false };
}

// ── Helpers ────────────────────────────────────────────────────────────
function formatBytes(n: number) {
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(1)}k chars`;
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Parser: plain text → sections ─────────────────────────────────────
function parseIcp(text: string): Section[] {
  if (!text.trim()) return KNOWN_SECTIONS.map(emptySection);

  // Divide en bloques usando líneas "---" como separadores
  const blocks = text.split(/\n?^---$/m).map((b) => b.trim()).filter(Boolean);

  const parsed: { title: string; content: string }[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const firstLine = lines[0].trim();
    // Es título si está en mayúsculas (acepta Ñ, tildes, espacios y guiones)
    const isTitle =
      firstLine.length > 1 &&
      firstLine === firstLine.toUpperCase() &&
      /[A-ZÁÉÍÓÚÑÜ]/.test(firstLine);

    if (isTitle) {
      parsed.push({ title: firstLine, content: lines.slice(1).join("\n").trim() });
    } else if (parsed.length > 0) {
      // Bloque sin título → anexar al anterior
      parsed[parsed.length - 1].content += "\n\n" + block;
    } else {
      parsed.push({ title: "GENERAL", content: block });
    }
  }

  // Mapear a secciones canónicas (mantiene orden fijo)
  const sections: Section[] = KNOWN_SECTIONS.map((ks) => {
    const match = parsed.find(
      (p) => normalizeTitle(p.title) === normalizeTitle(ks.title)
    );
    return { id: ks.id, title: ks.title, content: match?.content ?? "", collapsed: false };
  });

  // Añadir secciones extras no canónicas
  for (const p of parsed) {
    const isKnown = KNOWN_SECTIONS.some(
      (ks) => normalizeTitle(ks.title) === normalizeTitle(p.title)
    );
    if (!isKnown) {
      sections.push({
        id: normalizeTitle(p.title).replace(/\s+/g, "_") || "extra",
        title: p.title,
        content: p.content,
        collapsed: false,
      });
    }
  }

  return sections;
}

// ── Serializer: sections → plain text ─────────────────────────────────
function serializeIcp(sections: Section[]): string {
  return sections
    .filter((s) => s.content.trim())
    .map((s) => `---\n${s.title}\n---\n${s.content.trim()}`)
    .join("\n\n");
}

// ── Main component ─────────────────────────────────────────────────────
export default function IcpPage() {
  const { currentClient } = useClient();
  const [doc, setDoc]       = useState<IcpDoc | null>(null);
  const [rawText, setRawText] = useState("");
  const [sections, setSections] = useState<Section[]>(() =>
    KNOWN_SECTIONS.map(emptySection)
  );
  const [mode, setMode]     = useState<"form" | "text">("form");
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
    const r = await fetch(`/api/clients/${currentClient.id}/context`, { cache: "no-store" });
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
      setSections(KNOWN_SECTIONS.map(emptySection));
    }
  }

  useEffect(() => { load(); }, [currentClient?.id]);

  // Sincronizar al cambiar de vista
  function switchMode(next: "form" | "text") {
    if (next === "text" && mode === "form") {
      setRawText(serializeIcp(sections));
    }
    if (next === "form" && mode === "text") {
      setSections(parseIcp(rawText));
    }
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
    const content = mode === "form" ? serializeIcp(sections) : rawText;
    if (!content.trim()) return;
    setSaving(true);
    setError(null);

    const r = doc
      ? await fetch(`/api/clients/${currentClient.id}/context/${doc.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_name: fileName, content })
        })
      : await fetch(`/api/clients/${currentClient.id}/context`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_name: fileName, file_type: "icp", content })
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
    const r = await fetch(`/api/clients/${currentClient.id}/context/${doc.id}`, {
      method: "DELETE"
    });
    setDeleting(false);
    if (r.ok) {
      setDoc(null);
      setRawText("");
      setSections(KNOWN_SECTIONS.map(emptySection));
      setFileName("ICP");
      setSavedAt(null);
    }
  }

  function toggleSection(id: string) {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, collapsed: !s.collapsed } : s))
    );
  }

  function updateSection(id: string, content: string) {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, content } : s))
    );
    setSavedAt(null);
  }

  const hasContent =
    mode === "form"
      ? sections.some((s) => s.content.trim().length > 0)
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
    <div className="space-y-5 max-w-2xl">
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

          {/* Toggle vista formulario / texto */}
          <div
            className="flex rounded-lg overflow-hidden"
            style={{ border: "1px solid #E5E2F0" }}
          >
            <button
              onClick={() => switchMode("form")}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs transition"
              style={{
                background: mode === "form" ? "#251762" : "transparent",
                color:      mode === "form" ? "#fff"    : undefined
              }}
              title="Vista formulario"
            >
              <IconLayoutList size={13} /> Formulario
            </button>
            <button
              onClick={() => switchMode("text")}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs transition"
              style={{
                background: mode === "text" ? "#251762" : "transparent",
                color:      mode === "text" ? "#fff"    : undefined
              }}
              title="Vista texto plano"
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
        // ── Vista formulario ───────────────────────────────────────────
        <div className="space-y-3">
          {/* Nombre del documento */}
          <div className="card py-3">
            <div className="flex items-center gap-3">
              <IconFileText size={15} className="text-ink-subtle shrink-0" />
              <input
                className="input flex-1"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="Nombre del documento"
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
              <p className="font-medium text-ink">Sube el archivo ICP del cliente</p>
              <p className="text-sm text-ink-muted mt-1">
                .txt · .md · .docx · .pdf — o escribe directamente en cada sección
              </p>
            </button>
          )}

          {/* Secciones colapsables */}
          {sections.map((section) => (
            <SectionBlock
              key={section.id}
              section={section}
              onToggle={() => toggleSection(section.id)}
              onChange={(v) => updateSection(section.id, v)}
            />
          ))}

          {doc && (
            <p className="text-xs text-ink-subtle">
              Última actualización:{" "}
              {new Date(doc.uploaded_at).toLocaleDateString("es", {
                day: "2-digit",
                month: "short",
                year: "numeric"
              })}
            </p>
          )}
        </div>
      ) : (
        // ── Vista texto plano ──────────────────────────────────────────
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

          {!rawText && (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-[#E5E2F0] rounded-xl p-8 text-center hover:border-brand transition-colors"
            >
              <IconUpload size={24} className="mx-auto mb-2 text-ink-subtle" />
              <p className="font-medium text-ink">Sube o pega el ICP aquí</p>
            </button>
          )}

          <textarea
            className="input min-h-[520px] font-mono text-xs leading-relaxed"
            placeholder={
              "Pega el contenido del ICP o sube un archivo.\n\n" +
              "Formato esperado:\n" +
              "---\nDATOS DEL CLIENTE\n---\ncontenido...\n\n" +
              "---\nPERFIL DE EMPRESA OBJETIVO\n---\ncontenido..."
            }
            value={rawText}
            onChange={(e) => { setRawText(e.target.value); setSavedAt(null); }}
          />

          {doc && (
            <p className="text-xs text-ink-subtle">
              Última actualización:{" "}
              {new Date(doc.uploaded_at).toLocaleDateString("es", {
                day: "2-digit",
                month: "short",
                year: "numeric"
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
  onChange
}: {
  section: Section;
  onToggle: () => void;
  onChange: (v: string) => void;
}) {
  const hasContent = section.content.trim().length > 0;

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #E5E2F0" }}>
      {/* Header de sección */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        style={{ background: "#251762" }}
        onClick={onToggle}
      >
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-sm text-white tracking-wide">
            {section.title}
          </span>
          {hasContent && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(98,224,216,0.2)", color: "#62E0D8" }}
            >
              {formatBytes(section.content.length)}
            </span>
          )}
        </div>
        <IconChevronDown
          size={16}
          style={{
            color: "#62E0D8",
            transform: section.collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 0.2s"
          }}
        />
      </button>

      {/* Contenido editable */}
      {!section.collapsed && (
        <div className="p-4 bg-white">
          <textarea
            className="input w-full text-sm leading-relaxed"
            style={{ minHeight: hasContent ? "140px" : "80px" }}
            placeholder={`Contenido de ${section.title.toLowerCase()}…`}
            value={section.content}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
