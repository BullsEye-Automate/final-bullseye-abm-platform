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
  IconX
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";

type IcpDoc = {
  id: string;
  file_name: string;
  file_type: string;
  content: string;
  uploaded_at: string;
};

function formatBytes(n: number) {
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(1)}k chars`;
}

export default function IcpPage() {
  const { currentClient } = useClient();
  const [doc, setDoc]         = useState<IcpDoc | null>(null);
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("ICP");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [parsing, setParsing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!currentClient) return;
    setLoading(true);
    setError(null);
    const r = await fetch(`/api/clients/${currentClient.id}/context`, { cache: "no-store" });
    const j = await r.json();
    setLoading(false);
    if (j.error) { setError(j.error); return; }
    const icpDoc = (j.items ?? []).find((i: IcpDoc) => i.file_type === "icp") ?? null;
    setDoc(icpDoc);
    setContent(icpDoc?.content ?? "");
    setFileName(icpDoc?.file_name ?? "ICP");
    setSavedAt(null);
  }

  useEffect(() => { load(); }, [currentClient?.id]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const baseName = file.name.replace(/\.[^.]+$/, "");

    if (ext === "txt" || ext === "md" || ext === "markdown") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setContent((ev.target?.result as string) ?? "");
        setFileName(baseName);
        setSavedAt(null);
      };
      reader.readAsText(file, "utf-8");
      return;
    }

    // DOCX o PDF → parseo servidor
    setParsing(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/parse-document", { method: "POST", body: form });
    const j = await r.json();
    setParsing(false);
    if (j.error) { setError(`Error al leer el archivo: ${j.error}`); return; }
    setContent(j.text ?? "");
    setFileName(baseName);
    setSavedAt(null);
  }

  async function save() {
    if (!currentClient || !content.trim()) return;
    setSaving(true);
    setError(null);

    let r: Response;
    if (doc) {
      r = await fetch(`/api/clients/${currentClient.id}/context/${doc.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: fileName, content })
      });
    } else {
      r = await fetch(`/api/clients/${currentClient.id}/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: fileName, file_type: "icp", content })
      });
    }

    const j = await r.json();
    setSaving(false);
    if (j.error) { setError(j.error); return; }
    const saved = j.item;
    setDoc(saved);
    setContent(saved.content);
    setFileName(saved.file_name);
    setSavedAt(new Date().toLocaleTimeString());
  }

  async function remove() {
    if (!currentClient || !doc) return;
    setDeleting(true);
    const r = await fetch(`/api/clients/${currentClient.id}/context/${doc.id}`, { method: "DELETE" });
    setDeleting(false);
    if (r.ok) { setDoc(null); setContent(""); setFileName("ICP"); setSavedAt(null); }
  }

  if (!currentClient) {
    return (
      <div className="card flex items-center gap-3 text-warning-fg border border-warning-bg bg-warning-bg/40 text-sm max-w-xl">
        <IconAlertCircle size={18} className="shrink-0" />
        Selecciona un cliente en el sidebar para gestionar su ICP.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <header className="flex items-end justify-between">
        <div>
          <div className="label">Sistema · Configuración</div>
          <h1 className="text-2xl font-semibold tracking-tight">ICP — Ideal Customer Profile</h1>
          <div className="flex items-center gap-2 mt-1">
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

        <div className="flex items-center gap-2">
          {savedAt && (
            <span className="text-xs text-success-fg flex items-center gap-1">
              <IconCheck size={13} /> Guardado {savedAt}
            </span>
          )}
          {doc && (
            <button
              className="btn-secondary py-1.5 px-3 text-danger-fg"
              onClick={remove}
              disabled={deleting}
              title="Eliminar ICP"
            >
              {deleting ? <IconLoader2 size={14} className="animate-spin" /> : <IconTrash size={14} />}
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
            disabled={saving || !content.trim()}
          >
            {saving ? <IconLoader2 size={15} className="animate-spin" /> : <IconDeviceFloppy size={15} />}
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
          <button className="ml-auto" onClick={() => setError(null)}><IconX size={14} /></button>
        </div>
      )}

      {loading ? (
        <div className="card flex items-center gap-3 text-ink-muted">
          <IconLoader2 size={18} className="animate-spin" /> Cargando ICP…
        </div>
      ) : (
        <div className="card space-y-4">
          {/* Nombre del documento */}
          <div className="flex items-center gap-3">
            <IconFileText size={16} className="text-ink-subtle shrink-0" />
            <input
              className="input flex-1"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="Nombre del documento"
            />
            {content && (
              <span className="text-xs text-ink-subtle whitespace-nowrap">
                {formatBytes(content.length)}
              </span>
            )}
          </div>

          {/* Zona de carga si no hay contenido */}
          {!content && !parsing && (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-[#E5E2F0] rounded-xl p-10 text-center hover:border-brand transition-colors"
            >
              <IconUpload size={28} className="mx-auto mb-2 text-ink-subtle" />
              <p className="font-medium text-ink">Sube el archivo ICP del cliente</p>
              <p className="text-sm text-ink-muted mt-1">
                .txt, .md, .docx o .pdf — o pega el contenido directamente abajo
              </p>
            </button>
          )}

          {/* Textarea editable */}
          <div>
            <label className="label block mb-1">Contenido del ICP</label>
            <textarea
              className="input min-h-[480px] font-mono text-xs leading-relaxed"
              placeholder={`Pega aquí o sube el ICP del cliente.\n\nEjemplo de estructura:\n- Tipos de organización objetivo\n- Señales digitales de fit\n- Tamaños de empresa ideales\n- Geografías prioritarias\n- Competidores a monitorear\n- Notas adicionales`}
              value={content}
              onChange={(e) => { setContent(e.target.value); setSavedAt(null); }}
            />
          </div>

          {doc && (
            <p className="text-xs text-ink-subtle">
              Última actualización: {new Date(doc.uploaded_at).toLocaleDateString("es", {
                day: "2-digit", month: "short", year: "numeric"
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
