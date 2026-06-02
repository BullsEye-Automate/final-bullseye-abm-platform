"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconFlask,
  IconSparkles,
  IconCheck,
  IconTrash,
  IconLoader2,
  IconStar,
  IconStarFilled,
  IconChevronDown,
  IconChevronUp,
  IconChevronRight,
  IconSearch,
  IconX,
  IconDeviceFloppy,
  IconBrain,
  IconAlertCircle,
  IconPlus,
  IconLink,
  IconFileText,
  IconTag,
  IconEdit,
  IconRoute,
  IconUpload,
} from "@tabler/icons-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Tab = "segments" | "lab" | "examples" | "style";

type GeneratedMessages = {
  emailSubject?: string;
  emailBody?: string;
  linkedinIcebreaker?: string;
};

type Routing = {
  segmentId: string | null;
  segmentName: string | null;
  reasoning: string;
};

type Source = {
  id: string;
  segment_id: string;
  source_type: "text" | "url" | "document";
  title: string | null;
  content: string | null;
  url: string | null;
  created_at: string;
};

type Segment = {
  id: string;
  name: string;
  description: string | null;
  routing_hint: string;
  segment_sources?: Source[];
  created_at: string;
};

type Example = {
  id: string;
  segment_id?: string | null;
  contact_name?: string;
  job_title?: string;
  company_name?: string;
  email_subject: string;
  email_body: string;
  icebreaker?: string;
  had_reply: boolean;
  notes?: string;
  created_at: string;
};

type StyleGuide = { tone: string; rules: string; avoid: string; email_length: string };

type ContactSuggestion = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  company_name: string | null;
  email: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function EmptyState({ icon, text, action }: { icon: React.ReactNode; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-ink-muted">
      <div className="opacity-30">{icon}</div>
      <p className="text-sm">{text}</p>
      {action}
    </div>
  );
}

function MessageBlock({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={label.includes("Body") ? 6 : 2}
        className="w-full text-sm border border-[#E5E2F0] rounded-xl px-3 py-2.5 outline-none focus:border-[#62E0D8] resize-y bg-white"
      />
      {label.includes("Icebreaker") && (
        <p className="text-[10px] text-ink-muted text-right">{value.length}/180 chars</p>
      )}
    </div>
  );
}

// ─── TAB: Segmentos ───────────────────────────────────────────────────────────

function SegmentsTab({ clientId }: { clientId: string }) {
  const [segments, setSegments]       = useState<Segment[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState<string | null>(null);
  const [creating, setCreating]       = useState(false);
  const [newSeg, setNewSeg]           = useState({ name: "", description: "", routing_hint: "" });
  const [saving, setSaving]           = useState(false);
  const [editSeg, setEditSeg]         = useState<Partial<Segment> | null>(null);
  const [addingSource, setAddingSource] = useState<string | null>(null); // segment id
  const [srcForm, setSrcForm]         = useState({ type: "text" as "text" | "url" | "file", title: "", content: "", url: "" });
  const [srcFile, setSrcFile]         = useState<File | null>(null);
  const [srcLoading, setSrcLoading]   = useState(false);
  const [srcError, setSrcError]       = useState<string | null>(null);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/training/segments?client_id=${clientId}`);
    if (res.ok) setSegments((await res.json()).segments ?? []);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function createSegment() {
    if (!newSeg.name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/training/segments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, ...newSeg }),
    });
    if (res.ok) {
      const d = await res.json();
      setSegments((p) => [...p, { ...d.segment, segment_sources: [] }]);
      setNewSeg({ name: "", description: "", routing_hint: "" });
      setCreating(false);
      setSelected(d.segment.id);
    }
    setSaving(false);
  }

  async function saveEdit(id: string) {
    if (!editSeg) return;
    setSaving(true);
    const res = await fetch(`/api/training/segments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editSeg),
    });
    if (res.ok) {
      const d = await res.json();
      setSegments((p) => p.map((s) => s.id === id ? { ...s, ...d.segment } : s));
      setEditSeg(null);
    }
    setSaving(false);
  }

  async function deleteSegment(id: string) {
    if (!confirm("¿Eliminar este segmento y todas sus fuentes?")) return;
    await fetch(`/api/training/segments/${id}`, { method: "DELETE" });
    setSegments((p) => p.filter((s) => s.id !== id));
    if (selected === id) setSelected(null);
  }

  function resetSrcForm() {
    setSrcForm({ type: "text", title: "", content: "", url: "" });
    setSrcFile(null);
    setSrcError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSrcFile(file);
    if (!srcForm.title) setSrcForm((p) => ({ ...p, title: file.name }));
  }

  async function addSource(segmentId: string) {
    setSrcLoading(true);
    setSrcError(null);

    let content = srcForm.content;

    // Para archivos: leer el texto del archivo en el cliente
    if (srcForm.type === "file" && srcFile) {
      try {
        content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve((ev.target?.result as string) ?? "");
          reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
          reader.readAsText(srcFile, "UTF-8");
        });
      } catch {
        setSrcError("No se pudo leer el archivo. Asegúrate de que sea un archivo de texto (.txt, .md, .csv).");
        setSrcLoading(false);
        return;
      }
    }

    const body: Record<string, string> = {
      source_type: srcForm.type === "file" ? "document" : srcForm.type,
      title: srcForm.title.trim(),
    };
    if (srcForm.type === "url") body.url = srcForm.url;
    else body.content = content;

    const res = await fetch(`/api/training/segments/${segmentId}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) {
      setSrcError(d.error ?? "Error al guardar la fuente");
      setSrcLoading(false);
      return;
    }
    setSegments((p) =>
      p.map((s) =>
        s.id === segmentId
          ? { ...s, segment_sources: [...(s.segment_sources ?? []), d.source] }
          : s
      )
    );
    setAddingSource(null);
    resetSrcForm();
    setSrcLoading(false);
  }

  async function deleteSource(segmentId: string, sourceId: string) {
    await fetch(`/api/training/sources/${sourceId}`, { method: "DELETE" });
    setSegments((p) =>
      p.map((s) =>
        s.id === segmentId
          ? { ...s, segment_sources: (s.segment_sources ?? []).filter((src) => src.id !== sourceId) }
          : s
      )
    );
  }

  if (loading) return <div className="flex justify-center py-16"><IconLoader2 size={24} className="animate-spin text-ink-muted" /></div>;

  const seg = selected ? segments.find((s) => s.id === selected) : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Lista de segmentos */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">Segmentos</p>
          <button
            onClick={() => { setCreating(true); setSelected(null); }}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition"
            style={{ background: "#251762", color: "white" }}
          >
            <IconPlus size={12} /> Nuevo
          </button>
        </div>

        {creating && (
          <div className="card px-4 py-4 space-y-3 border-2" style={{ borderColor: "#62E0D8" }}>
            <p className="text-xs font-semibold text-ink uppercase tracking-wide">Nuevo segmento</p>
            <div className="space-y-2">
              <input
                value={newSeg.name}
                onChange={(e) => setNewSeg((p) => ({ ...p, name: e.target.value }))}
                placeholder="Nombre del segmento *"
                className="w-full text-sm border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8]"
              />
              <input
                value={newSeg.description}
                onChange={(e) => setNewSeg((p) => ({ ...p, description: e.target.value }))}
                placeholder="Descripción (opcional)"
                className="w-full text-sm border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8]"
              />
              <textarea
                value={newSeg.routing_hint}
                onChange={(e) => setNewSeg((p) => ({ ...p, routing_hint: e.target.value }))}
                rows={3}
                placeholder="Criterio de enrutamiento: ¿cuándo debe la IA elegir este segmento? Ej: Empresas con más de 200 empleados en industria fintech o SaaS"
                className="w-full text-sm border border-[#E5E2F0] rounded-xl px-3 py-2.5 outline-none focus:border-[#62E0D8] resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={createSegment}
                disabled={saving || !newSeg.name.trim()}
                className="flex-1 text-sm py-2 rounded-lg text-white disabled:opacity-40 transition"
                style={{ background: "#251762" }}
              >
                {saving ? "Guardando…" : "Crear segmento"}
              </button>
              <button
                onClick={() => { setCreating(false); setNewSeg({ name: "", description: "", routing_hint: "" }); }}
                className="px-3 text-sm rounded-lg border border-[#E5E2F0] text-ink-muted hover:bg-gray-50"
              >
                <IconX size={14} />
              </button>
            </div>
          </div>
        )}

        {!segments.length && !creating && (
          <div className="text-center py-10 text-ink-muted text-sm space-y-2">
            <IconTag size={32} className="mx-auto opacity-20" />
            <p>Sin segmentos aún.</p>
            <p className="text-xs">Crea un segmento para personalizar mensajes por tipo de cliente.</p>
          </div>
        )}

        {segments.map((s) => (
          <button
            key={s.id}
            onClick={() => { setSelected(s.id); setEditSeg(null); setCreating(false); }}
            className="w-full text-left card px-4 py-3 transition hover:shadow-md"
            style={selected === s.id ? { borderColor: "#62E0D8", borderWidth: 2 } : {}}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{s.name}</p>
                {s.description && <p className="text-xs text-ink-muted truncate mt-0.5">{s.description}</p>}
                <p className="text-[11px] text-ink-muted mt-1">
                  {(s.segment_sources ?? []).length} fuente{(s.segment_sources ?? []).length !== 1 ? "s" : ""}
                </p>
              </div>
              <IconChevronRight size={14} className="text-ink-muted shrink-0" />
            </div>
          </button>
        ))}
      </div>

      {/* Panel de edición del segmento */}
      <div className="lg:col-span-2">
        {!seg && !selected && (
          <EmptyState icon={<IconTag size={48} />} text="Selecciona un segmento para editarlo." />
        )}

        {seg && (
          <div className="space-y-5">
            {/* Header del segmento */}
            <div className="card px-5 py-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                {editSeg ? (
                  <input
                    value={editSeg.name ?? seg.name}
                    onChange={(e) => setEditSeg((p) => ({ ...p, name: e.target.value }))}
                    className="flex-1 text-sm font-semibold border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8]"
                  />
                ) : (
                  <div>
                    <p className="font-semibold text-ink">{seg.name}</p>
                    {seg.description && <p className="text-xs text-ink-muted mt-0.5">{seg.description}</p>}
                  </div>
                )}
                <div className="flex gap-1.5 shrink-0">
                  {editSeg ? (
                    <>
                      <button
                        onClick={() => saveEdit(seg.id)}
                        disabled={saving}
                        className="text-xs px-3 py-1.5 rounded-lg text-white transition"
                        style={{ background: "#251762" }}
                      >
                        {saving ? "Guardando…" : "Guardar"}
                      </button>
                      <button onClick={() => setEditSeg(null)} className="text-xs px-3 py-1.5 rounded-lg border border-[#E5E2F0] text-ink-muted hover:bg-gray-50">
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setEditSeg({ name: seg.name, description: seg.description ?? "", routing_hint: seg.routing_hint })} className="text-xs px-2.5 py-1.5 rounded-lg border border-[#E5E2F0] text-ink-muted hover:bg-gray-50 flex items-center gap-1">
                        <IconEdit size={12} /> Editar
                      </button>
                      <button onClick={() => deleteSegment(seg.id)} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 flex items-center gap-1">
                        <IconTrash size={12} /> Eliminar
                      </button>
                    </>
                  )}
                </div>
              </div>

              {editSeg && (
                <input
                  value={editSeg.description ?? ""}
                  onChange={(e) => setEditSeg((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Descripción (opcional)"
                  className="w-full text-sm border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8]"
                />
              )}

              {/* Routing hint */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <IconRoute size={13} style={{ color: "#7C3AED" }} />
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    Criterio de enrutamiento automático
                  </label>
                </div>
                {editSeg ? (
                  <textarea
                    value={editSeg.routing_hint ?? ""}
                    onChange={(e) => setEditSeg((p) => ({ ...p, routing_hint: e.target.value }))}
                    rows={3}
                    placeholder="Describe cuándo la IA debe elegir este segmento. Ej: Empresas B2B con más de 100 empleados en industria fintech, SaaS o banca digital"
                    className="w-full text-sm border border-[#E5E2F0] rounded-xl px-3 py-2.5 outline-none focus:border-[#62E0D8] resize-none"
                  />
                ) : (
                  <div
                    className="text-sm text-ink px-3 py-2.5 rounded-xl"
                    style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.15)" }}
                  >
                    {seg.routing_hint || <span className="text-ink-muted italic">Sin criterio definido</span>}
                  </div>
                )}
                <p className="text-[10px] text-ink-muted">
                  La IA lee este criterio para decidir automáticamente qué segmento aplica a cada contacto.
                </p>
              </div>
            </div>

            {/* Fuentes de conocimiento */}
            <div className="card px-5 py-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-ink text-sm">Fuentes de conocimiento</p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    Agrega documentos, textos o URLs que la IA debe conocer para este segmento.
                  </p>
                </div>
                <button
                  onClick={() => setAddingSource(seg.id)}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-[#E5E2F0] text-ink-muted hover:bg-gray-50 transition shrink-0"
                >
                  <IconPlus size={12} /> Agregar
                </button>
              </div>

              {addingSource === seg.id && (
                <div className="border border-[#E5E2F0] rounded-xl px-4 py-4 space-y-3 bg-gray-50/50">
                  {/* Selector de tipo + botón cancelar en la misma fila */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {([
                      { t: "text",  label: "Texto",   icon: <IconFileText size={12} /> },
                      { t: "url",   label: "URL",     icon: <IconLink size={12} /> },
                      { t: "file",  label: "Archivo", icon: <IconUpload size={12} /> },
                    ] as const).map(({ t, label, icon }) => (
                      <button
                        key={t}
                        onClick={() => { setSrcForm((p) => ({ ...p, type: t })); setSrcFile(null); setSrcError(null); }}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition"
                        style={srcForm.type === t
                          ? { background: "#251762", color: "white", borderColor: "#251762" }
                          : { background: "white", color: "#6B6884", borderColor: "#E5E2F0" }
                        }
                      >
                        {icon}{label}
                      </button>
                    ))}
                    <button
                      onClick={() => { setAddingSource(null); resetSrcForm(); }}
                      className="ml-auto px-2.5 py-1.5 text-xs rounded-lg border border-[#E5E2F0] text-ink-muted hover:bg-gray-50 flex items-center gap-1"
                    >
                      <IconX size={12} /> Cancelar
                    </button>
                  </div>

                  {/* Título */}
                  <input
                    value={srcForm.title}
                    onChange={(e) => setSrcForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder={srcForm.type === "file" ? "Título (se llena automático)" : "Título (opcional)"}
                    className="w-full text-sm border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8] bg-white"
                  />

                  {/* Campo según tipo */}
                  {srcForm.type === "text" && (
                    <textarea
                      value={srcForm.content}
                      onChange={(e) => setSrcForm((p) => ({ ...p, content: e.target.value }))}
                      rows={5}
                      placeholder="Pega aquí el texto, descripción del producto, casos de éxito, argumentario de ventas…"
                      className="w-full text-sm border border-[#E5E2F0] rounded-xl px-3 py-2.5 outline-none focus:border-[#62E0D8] resize-none bg-white"
                    />
                  )}

                  {srcForm.type === "url" && (
                    <input
                      value={srcForm.url}
                      onChange={(e) => setSrcForm((p) => ({ ...p, url: e.target.value }))}
                      placeholder="https://..."
                      type="url"
                      className="w-full text-sm border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8] bg-white"
                    />
                  )}

                  {srcForm.type === "file" && (
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.md,.csv,.json,.xml,.html,.htm"
                        className="hidden"
                        onChange={handleFileSelect}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full text-sm border-2 border-dashed border-[#E5E2F0] rounded-xl px-4 py-6 text-center hover:border-[#251762] transition"
                      >
                        {srcFile ? (
                          <div className="flex items-center justify-center gap-2 text-ink">
                            <IconFileText size={16} style={{ color: "#62E0D8" }} />
                            <span className="font-medium">{srcFile.name}</span>
                            <span className="text-ink-muted text-xs">({(srcFile.size / 1024).toFixed(0)} KB)</span>
                          </div>
                        ) : (
                          <div className="text-ink-muted space-y-1">
                            <IconUpload size={20} className="mx-auto opacity-40" />
                            <p>Haz clic para seleccionar un archivo</p>
                            <p className="text-xs opacity-60">.txt · .md · .csv · .json · .html</p>
                          </div>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Error */}
                  {srcError && (
                    <p className="text-xs text-red-500 flex items-center gap-1.5">
                      <IconAlertCircle size={13} /> {srcError}
                    </p>
                  )}

                  {/* Botón guardar */}
                  <button
                    onClick={() => addSource(selected!)}
                    disabled={
                      srcLoading ||
                      (srcForm.type === "text" && !srcForm.content.trim()) ||
                      (srcForm.type === "url"  && !srcForm.url.trim()) ||
                      (srcForm.type === "file" && !srcFile)
                    }
                    className="w-full text-sm py-2.5 rounded-lg text-white disabled:opacity-40 transition flex items-center justify-center gap-2"
                    style={{ background: "#251762" }}
                  >
                    {srcLoading ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlus size={13} />}
                    {srcLoading
                      ? srcForm.type === "url"  ? "Obteniendo contenido…"
                      : srcForm.type === "file" ? "Leyendo archivo…"
                      : "Guardando…"
                      : "Agregar fuente"
                    }
                  </button>
                </div>
              )}

              {(seg.segment_sources ?? []).length === 0 && addingSource !== seg.id && (
                <div className="text-center py-6 text-ink-muted text-sm">
                  <IconFileText size={24} className="mx-auto opacity-20 mb-2" />
                  <p className="text-xs">Sin fuentes. Agrega textos o URLs para que la IA aprenda sobre este segmento.</p>
                </div>
              )}

              <div className="space-y-2">
                {(seg.segment_sources ?? []).map((src) => (
                  <div key={src.id} className="flex items-start gap-3 px-3 py-2.5 rounded-xl border border-[#E5E2F0]">
                    <div className="mt-0.5 shrink-0">
                      {src.source_type === "url" ? (
                        <IconLink size={14} className="text-ink-muted" />
                      ) : (
                        <IconFileText size={14} className="text-ink-muted" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{src.title || (src.url ?? "Texto sin título")}</p>
                      {src.url && <p className="text-xs text-ink-muted truncate">{src.url}</p>}
                      {src.content && (
                        <p className="text-xs text-ink-muted mt-0.5 line-clamp-2">{src.content.slice(0, 120)}…</p>
                      )}
                    </div>
                    <button
                      onClick={() => deleteSource(seg.id, src.id)}
                      className="shrink-0 text-red-300 hover:text-red-500 transition mt-0.5"
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TAB: Laboratorio ─────────────────────────────────────────────────────────

function LabTab({ clientId }: { clientId: string }) {
  const [mode, setMode]               = useState<"search" | "manual">("search");
  const [query, setQuery]             = useState("");
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [selected, setSelected]       = useState<ContactSuggestion | null>(null);
  const [manual, setManual]           = useState({ firstName: "", lastName: "", jobTitle: "", companyName: "", industry: "", companySize: "", hasEmail: true });
  const [generating, setGenerating]   = useState(false);
  const [messages, setMessages]       = useState<GeneratedMessages | null>(null);
  const [edited, setEdited]           = useState<GeneratedMessages>({});
  const [routing, setRouting]         = useState<Routing | null>(null);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [feedback, setFeedback]       = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [genError, setGenError]       = useState<string | null>(null);
  const [segmentId, setSegmentId]     = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim() || mode !== "search") { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/contacts?client_id=${clientId}&search=${encodeURIComponent(query)}&limit=6`);
      if (res.ok) setSuggestions((await res.json()).contacts ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [query, clientId, mode]);

  const setField = (f: keyof GeneratedMessages) => (v: string) =>
    setEdited((p) => ({ ...p, [f]: v }));

  async function generate(withFeedback?: string) {
    setGenError(null);
    if (mode === "search" && !selected) return;
    if (mode === "manual" && !manual.firstName && !manual.jobTitle) return;

    if (messages) setRegenerating(true); else setGenerating(true);

    const payload: Record<string, unknown> = { client_id: clientId };
    if (mode === "search" && selected) payload.contact_id = selected.id;
    else payload.manual = manual;
    if (withFeedback) payload.feedback = withFeedback;

    try {
      const res = await fetch("/api/training/lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) { setGenError(d.error ?? "Error al generar"); return; }
      const msgs = d.messages as GeneratedMessages;
      setMessages(msgs);
      setEdited({
        emailSubject:       msgs.emailSubject       ?? "",
        emailBody:          msgs.emailBody          ?? "",
        linkedinIcebreaker: msgs.linkedinIcebreaker ?? "",
      });
      setRouting(d.routing ?? null);
      setSegmentId(d.routing?.segmentId ?? null);
      setFeedback("");
      setSaved(false);
    } catch (err: unknown) {
      setGenError((err as Error)?.message ?? "Error de red");
    } finally {
      setGenerating(false);
      setRegenerating(false);
    }
  }

  async function saveAsExample() {
    setSaving(true);
    const contactName = selected
      ? [selected.first_name, selected.last_name].filter(Boolean).join(" ")
      : [manual.firstName, manual.lastName].filter(Boolean).join(" ");

    await fetch("/api/training/examples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id:     clientId,
        segment_id:    segmentId ?? undefined,
        contact_name:  contactName || undefined,
        job_title:     (selected?.job_title  ?? manual.jobTitle)    || undefined,
        company_name:  (selected?.company_name ?? manual.companyName) || undefined,
        email_subject: edited.emailSubject ?? "",
        email_body:    edited.emailBody    ?? "",
        icebreaker:    edited.linkedinIcebreaker ?? "",
      }),
    });
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Panel izquierdo */}
      <div className="space-y-4">
        <div className="card px-5 py-4 space-y-4">
          <div className="flex gap-2">
            {(["search", "manual"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setSelected(null); setQuery(""); }}
                className="text-sm px-3 py-1.5 rounded-lg border transition"
                style={mode === m
                  ? { background: "#251762", color: "white", borderColor: "#251762" }
                  : { background: "white", color: "#6B6884", borderColor: "#E5E2F0" }
                }
              >
                {m === "search" ? "Buscar contacto" : "Ingresar manual"}
              </button>
            ))}
          </div>

          {mode === "search" && (
            <div className="space-y-3">
              <div className="relative">
                <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Nombre, empresa o cargo…"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-[#E5E2F0] rounded-lg outline-none focus:border-[#62E0D8]"
                />
              </div>
              {suggestions.length > 0 && !selected && (
                <div className="border border-[#E5E2F0] rounded-xl overflow-hidden divide-y divide-[#F0EEF8]">
                  {suggestions.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setSelected(c); setSuggestions([]); setQuery([c.first_name, c.last_name].filter(Boolean).join(" ")); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition"
                    >
                      <div className="w-7 h-7 rounded-full bg-[#251762] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                        {[c.first_name?.[0], c.last_name?.[0]].filter(Boolean).join("").toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink truncate">
                          {[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}
                        </div>
                        <div className="text-xs text-ink-muted truncate">
                          {[c.job_title, c.company_name].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selected && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(98,224,216,0.1)" }}>
                  <IconCheck size={14} style={{ color: "#62E0D8" }} />
                  <span className="text-sm font-medium text-ink">
                    {[selected.first_name, selected.last_name].filter(Boolean).join(" ")}
                    {selected.job_title && <span className="font-normal text-ink-muted"> · {selected.job_title}</span>}
                  </span>
                  <button onClick={() => { setSelected(null); setQuery(""); }} className="ml-auto text-ink-muted hover:text-ink"><IconX size={13} /></button>
                </div>
              )}
            </div>
          )}

          {mode === "manual" && (
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: "firstName",   label: "Nombre" },
                { key: "lastName",    label: "Apellido" },
                { key: "jobTitle",    label: "Cargo" },
                { key: "companyName", label: "Empresa" },
                { key: "industry",    label: "Industria" },
                { key: "companySize", label: "Tamaño empresa" },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</label>
                  <input
                    value={(manual as Record<string, string>)[key]}
                    onChange={(e) => setManual((p) => ({ ...p, [key]: e.target.value }))}
                    className="mt-1 w-full text-sm border border-[#E5E2F0] rounded-lg px-3 py-2 outline-none focus:border-[#62E0D8]"
                  />
                </div>
              ))}
              <label className="col-span-2 flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={manual.hasEmail} onChange={(e) => setManual((p) => ({ ...p, hasEmail: e.target.checked }))} />
                Tiene email
              </label>
            </div>
          )}

          <button
            onClick={() => generate()}
            disabled={generating || (mode === "search" && !selected) || (mode === "manual" && !manual.firstName && !manual.jobTitle)}
            className="btn-primary w-full flex items-center justify-center gap-2 text-sm disabled:opacity-40"
          >
            {generating ? <IconLoader2 size={14} className="animate-spin" /> : <IconSparkles size={14} />}
            {generating ? "Generando…" : "Generar mensajes"}
          </button>
        </div>

        {messages && (
          <div className="card px-5 py-4 space-y-3">
            <p className="text-sm font-semibold text-ink">Feedback para mejorar</p>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              placeholder="Ej: el subject es muy genérico, necesito algo más directo. El body es muy largo, reducirlo a 3 oraciones…"
              className="w-full text-sm border border-[#E5E2F0] rounded-xl px-3 py-2.5 outline-none focus:border-[#62E0D8] resize-none"
            />
            <button
              onClick={() => generate(feedback)}
              disabled={regenerating || !feedback.trim()}
              className="w-full flex items-center justify-center gap-2 text-sm px-4 py-2 rounded-lg border border-[#251762] text-[#251762] hover:bg-[#F1EEF7] transition disabled:opacity-40"
            >
              {regenerating ? <IconLoader2 size={13} className="animate-spin" /> : <IconSparkles size={13} />}
              Regenerar con feedback
            </button>
          </div>
        )}
      </div>

      {/* Panel derecho */}
      <div className="space-y-4">
        {genError && (
          <div className="card border-l-4 border-red-400 px-4 py-3 text-red-600 text-sm flex items-center gap-2">
            <IconAlertCircle size={14} /> {genError}
          </div>
        )}

        {!messages && !generating && (
          <EmptyState icon={<IconFlask size={48} />} text="Selecciona un contacto y genera los mensajes para ver el resultado aquí." />
        )}

        {generating && !messages && (
          <div className="card flex flex-col items-center justify-center py-16 gap-3">
            <IconLoader2 size={28} className="animate-spin" style={{ color: "#62E0D8" }} />
            <p className="text-sm text-ink-muted">Generando mensajes personalizados…</p>
          </div>
        )}

        {messages && (
          <div className="space-y-4">
            {/* Routing info */}
            {routing && (
              <div
                className="px-4 py-3 rounded-xl text-sm flex items-start gap-2.5"
                style={{
                  background: routing.segmentId ? "rgba(124,58,237,0.07)" : "rgba(107,104,132,0.07)",
                  border: `1px solid ${routing.segmentId ? "rgba(124,58,237,0.2)" : "rgba(107,104,132,0.15)"}`,
                }}
              >
                <IconRoute size={15} style={{ color: routing.segmentId ? "#7C3AED" : "#9CA3AF", marginTop: 1 }} className="shrink-0" />
                <div>
                  <span className="font-semibold" style={{ color: routing.segmentId ? "#7C3AED" : "#6B7280" }}>
                    {routing.segmentName ? `Segmento: ${routing.segmentName}` : "Sin segmento asignado"}
                  </span>
                  <p className="text-xs text-ink-muted mt-0.5">{routing.reasoning}</p>
                </div>
              </div>
            )}

            <div className="card px-5 py-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-ink text-sm">Mensajes generados</p>
                {regenerating && <IconLoader2 size={14} className="animate-spin text-ink-muted" />}
              </div>

              <MessageBlock label="Subject {{emailSubject}}" value={edited.emailSubject ?? ""} onChange={setField("emailSubject")} />
              <MessageBlock label="Email Body {{emailBody}}" value={edited.emailBody ?? ""} onChange={setField("emailBody")} />
              <MessageBlock label="LinkedIn Icebreaker {{icebreaker}}" value={edited.linkedinIcebreaker ?? ""} onChange={setField("linkedinIcebreaker")} />

              <button
                onClick={saveAsExample}
                disabled={saving || saved}
                className="w-full flex items-center justify-center gap-2 text-sm py-2.5 rounded-xl transition"
                style={saved
                  ? { background: "#EDF9F8", color: "#0F6E56", border: "1px solid #62E0D8" }
                  : { background: "#251762", color: "white" }
                }
              >
                {saving ? <IconLoader2 size={13} className="animate-spin" /> : saved ? <IconCheck size={13} /> : <IconStarFilled size={13} />}
                {saved
                  ? "Guardado como ejemplo aprobado"
                  : routing?.segmentName
                    ? `Guardar en segmento "${routing.segmentName}"`
                    : "Guardar como ejemplo global"
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TAB: Ejemplos ────────────────────────────────────────────────────────────

function ExamplesTab({ clientId }: { clientId: string }) {
  const [examples, setExamples]     = useState<Example[]>([]);
  const [segments, setSegments]     = useState<Segment[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [filterSeg, setFilterSeg]   = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const [exRes, segRes] = await Promise.all([
      fetch(`/api/training/examples?client_id=${clientId}`),
      fetch(`/api/training/segments?client_id=${clientId}`),
    ]);
    if (exRes.ok)  setExamples((await exRes.json()).examples ?? []);
    if (segRes.ok) setSegments((await segRes.json()).segments ?? []);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function toggleReply(id: string, had_reply: boolean) {
    await fetch(`/api/training/examples/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ had_reply }),
    });
    setExamples((p) => p.map((e) => e.id === id ? { ...e, had_reply } : e));
  }

  async function deleteExample(id: string) {
    await fetch(`/api/training/examples/${id}`, { method: "DELETE" });
    setExamples((p) => p.filter((e) => e.id !== id));
  }

  if (loading) return <div className="flex justify-center py-16"><IconLoader2 size={24} className="animate-spin text-ink-muted" /></div>;

  const filtered = filterSeg === "all"
    ? examples
    : filterSeg === "__global__"
      ? examples.filter((e) => !e.segment_id)
      : examples.filter((e) => e.segment_id === filterSeg);

  const withReply = filtered.filter((e) => e.had_reply).length;

  return (
    <div className="space-y-4">
      {/* Filtro por segmento */}
      {segments.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {[
            { id: "all",        label: `Todos (${examples.length})` },
            { id: "__global__", label: `Sin segmento (${examples.filter((e) => !e.segment_id).length})` },
            ...segments.map((s) => ({
              id:    s.id,
              label: `${s.name} (${examples.filter((e) => e.segment_id === s.id).length})`,
            })),
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => setFilterSeg(opt.id)}
              className="text-xs px-3 py-1.5 rounded-lg border transition"
              style={filterSeg === opt.id
                ? { background: "#251762", color: "white", borderColor: "#251762" }
                : { background: "white", color: "#6B6884", borderColor: "#E5E2F0" }
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-3 flex-wrap">
        <div className="card px-4 py-3 text-center min-w-[110px]">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Total</div>
          <div className="text-2xl font-bold text-ink mt-0.5">{filtered.length}</div>
        </div>
        <div className="card px-4 py-3 text-center min-w-[110px]">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Con reply</div>
          <div className="text-2xl font-bold mt-0.5" style={{ color: "#0F6E56" }}>{withReply}</div>
        </div>
        <div className="card px-4 py-3 flex-1 min-w-[200px]">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-2">Calidad del dataset</div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min((filtered.length / 10) * 100, 100)}%`, background: "#62E0D8" }} />
          </div>
          <div className="text-[11px] text-ink-muted mt-1">
            {filtered.length < 3 ? "Necesitas al menos 3 ejemplos" : filtered.length < 8 ? "Buen comienzo, sigue agregando" : "Excelente dataset"}
          </div>
        </div>
      </div>

      {filtered.length === 0 && (
        <EmptyState icon={<IconStarFilled size={48} />} text="Sin ejemplos aún. Genera mensajes en el Laboratorio y guárdalos aquí." />
      )}

      <div className="space-y-2">
        {filtered.map((ex) => {
          const segName = segments.find((s) => s.id === ex.segment_id)?.name;
          return (
            <div key={ex.id} className="card border border-[#E5E2F0]">
              <button
                onClick={() => setExpanded((p) => p === ex.id ? null : ex.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition rounded-xl"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-ink truncate">{ex.email_subject}</span>
                    {ex.had_reply && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: "#DCFCE7", color: "#166534" }}>
                        Con reply
                      </span>
                    )}
                    {segName && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: "rgba(124,58,237,0.1)", color: "#7C3AED" }}>
                        {segName}
                      </span>
                    )}
                  </div>
                  {(ex.contact_name || ex.job_title) && (
                    <div className="text-xs text-ink-muted mt-0.5">
                      {[ex.contact_name, ex.job_title, ex.company_name].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                {expanded === ex.id ? <IconChevronUp size={14} className="text-ink-muted shrink-0" /> : <IconChevronDown size={14} className="text-ink-muted shrink-0" />}
              </button>

              {expanded === ex.id && (
                <div className="px-4 pb-4 border-t border-[#E5E2F0] pt-3 space-y-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Email body</p>
                    <p className="text-sm text-ink mt-1 whitespace-pre-wrap">{ex.email_body}</p>
                  </div>
                  {ex.icebreaker && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Icebreaker LinkedIn</p>
                      <p className="text-sm text-ink mt-1">{ex.icebreaker}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => toggleReply(ex.id, !ex.had_reply)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition"
                      style={ex.had_reply
                        ? { background: "#DCFCE7", color: "#166534", borderColor: "#86EFAC" }
                        : { background: "white", color: "#6B6884", borderColor: "#E5E2F0" }
                      }
                    >
                      {ex.had_reply ? <IconStarFilled size={12} /> : <IconStar size={12} />}
                      {ex.had_reply ? "Tuvo reply" : "Marcar con reply"}
                    </button>
                    <button
                      onClick={() => deleteExample(ex.id)}
                      className="ml-auto flex items-center gap-1 text-xs text-red-400 hover:text-red-600 transition px-2 py-1.5 rounded-lg hover:bg-red-50"
                    >
                      <IconTrash size={12} /> Eliminar
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TAB: Guía de estilo ──────────────────────────────────────────────────────

function StyleTab({ clientId }: { clientId: string }) {
  const [style, setStyle]     = useState<StyleGuide>({ tone: "", rules: "", avoid: "", email_length: "corto" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    fetch(`/api/training/style-guide?client_id=${clientId}`)
      .then((r) => r.json())
      .then((d) => { if (d.style) setStyle(d.style); })
      .finally(() => setLoading(false));
  }, [clientId]);

  async function save() {
    setSaving(true);
    await fetch("/api/training/style-guide", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, ...style }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) return <div className="flex justify-center py-16"><IconLoader2 size={24} className="animate-spin text-ink-muted" /></div>;

  const LENGTH_OPTIONS = [
    { value: "corto", label: "Corto",  desc: "3 oraciones" },
    { value: "medio", label: "Medio",  desc: "4-5 oraciones" },
    { value: "largo", label: "Largo",  desc: "6+ oraciones" },
  ];

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-ink-muted">
        Estas reglas se inyectan en el prompt de Claude cada vez que se generan mensajes. Cuanto más específico seas, más parecidos serán a como tú escribes.
      </p>

      <div className="card px-5 py-4 space-y-3">
        <h3 className="font-semibold text-ink text-sm">Largo del email</h3>
        <div className="flex gap-2">
          {LENGTH_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStyle((p) => ({ ...p, email_length: opt.value }))}
              className="flex-1 py-3 rounded-xl border text-center transition"
              style={style.email_length === opt.value
                ? { background: "#251762", color: "white", borderColor: "#251762" }
                : { background: "white", color: "#6B6884", borderColor: "#E5E2F0" }
              }
            >
              <div className="text-sm font-semibold">{opt.label}</div>
              <div className="text-[11px] opacity-70 mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="card px-5 py-4 space-y-2">
        <h3 className="font-semibold text-ink text-sm">Tono y personalidad</h3>
        <p className="text-xs text-ink-muted">Describe el tono con el que quieres sonar.</p>
        <textarea
          value={style.tone}
          onChange={(e) => setStyle((p) => ({ ...p, tone: e.target.value }))}
          rows={3}
          placeholder="Ej: Directo y confiado, sin formalismos. Tuteo siempre. Frases cortas y al punto."
          className="w-full text-sm border border-[#E5E2F0] rounded-xl px-3 py-2.5 outline-none focus:border-[#62E0D8] resize-none"
        />
      </div>

      <div className="card px-5 py-4 space-y-2">
        <h3 className="font-semibold text-ink text-sm">Reglas de escritura</h3>
        <p className="text-xs text-ink-muted">Una regla por línea. Cómo estructuras los mensajes.</p>
        <textarea
          value={style.rules}
          onChange={(e) => setStyle((p) => ({ ...p, rules: e.target.value }))}
          rows={5}
          placeholder={`Ej:\nSiempre abrir con algo específico de la empresa o el cargo.\nTerminar con una pregunta abierta, nunca con "¿Tienes 15 minutos?".\nEl subject nunca lleva signos de pregunta.\nNo usar "espero que estés bien" ni frases de relleno.`}
          className="w-full text-sm border border-[#E5E2F0] rounded-xl px-3 py-2.5 outline-none focus:border-[#62E0D8] resize-y"
        />
      </div>

      <div className="card px-5 py-4 space-y-2">
        <h3 className="font-semibold text-ink text-sm">Palabras y frases a NUNCA usar</h3>
        <p className="text-xs text-ink-muted">Una por línea. Claude las evitará activamente.</p>
        <textarea
          value={style.avoid}
          onChange={(e) => setStyle((p) => ({ ...p, avoid: e.target.value }))}
          rows={4}
          placeholder={`Ej:\nespero que estés bien\ndisrupción / disruptivo\nsolución integral\n¿Tienes 15 minutos para una llamada?`}
          className="w-full text-sm border border-[#E5E2F0] rounded-xl px-3 py-2.5 outline-none focus:border-[#62E0D8] resize-y"
        />
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="btn-primary flex items-center gap-2 text-sm"
      >
        {saving ? <IconLoader2 size={14} className="animate-spin" /> : saved ? <IconCheck size={14} /> : <IconDeviceFloppy size={14} />}
        {saved ? "Guía guardada" : "Guardar guía de estilo"}
      </button>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

const TAB_CONFIG = [
  { id: "segments" as Tab, label: "Segmentos",         icon: <IconTag size={16} /> },
  { id: "lab"      as Tab, label: "Laboratorio",        icon: <IconFlask size={16} /> },
  { id: "examples" as Tab, label: "Ejemplos",           icon: <IconStarFilled size={16} /> },
  { id: "style"    as Tab, label: "Guía de estilo",     icon: <IconBrain size={16} /> },
];

export default function EntrenarModeloPage() {
  const { currentClient } = useClient();
  const [tab, setTab] = useState<Tab>("segments");

  if (!currentClient) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-ink-muted">Selecciona un cliente en el sidebar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <div className="label">Outreach · IA</div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconBrain size={22} style={{ color: "#62E0D8" }} /> Entrenar modelo
        </h1>
        <p className="text-sm text-ink-muted mt-0.5">
          Define segmentos, agrega fuentes de conocimiento y enseña a la IA a escribir como tú.
        </p>
      </header>

      <div className="flex gap-1 border-b border-[#E5E2F0]">
        {TAB_CONFIG.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition"
            style={tab === t.id
              ? { borderColor: "#62E0D8", color: "#62E0D8" }
              : { borderColor: "transparent", color: "#6B6884" }
            }
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {tab === "segments" && <SegmentsTab clientId={currentClient.id} />}
        {tab === "lab"      && <LabTab      clientId={currentClient.id} />}
        {tab === "examples" && <ExamplesTab clientId={currentClient.id} />}
        {tab === "style"    && <StyleTab    clientId={currentClient.id} />}
      </div>
    </div>
  );
}
