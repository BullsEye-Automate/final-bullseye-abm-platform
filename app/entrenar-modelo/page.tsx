"use client";

import { useCallback, useEffect, useState } from "react";
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
  IconSearch,
  IconX,
  IconDeviceFloppy,
  IconBrain,
  IconAlertCircle,
} from "@tabler/icons-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Tab = "lab" | "examples" | "style";

type GeneratedMessages = {
  emailSubject?: string;
  emailBody?: string;
  linkedinIcebreaker?: string;
};

type Example = {
  id: string;
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

type StyleGuide = {
  tone: string;
  rules: string;
  avoid: string;
  email_length: string;
};

type ContactSuggestion = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  company_name: string | null;
  email: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-ink-muted">
      <div className="opacity-30">{icon}</div>
      <p className="text-sm">{text}</p>
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

// ─── TAB: Laboratorio ─────────────────────────────────────────────────────────

function LabTab({ clientId }: { clientId: string }) {
  const [mode, setMode]               = useState<"search" | "manual">("search");
  const [query, setQuery]             = useState("");
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [selected, setSelected]       = useState<ContactSuggestion | null>(null);
  const [manual, setManual]           = useState({ firstName: "", lastName: "", jobTitle: "", companyName: "", hasEmail: true });
  const [generating, setGenerating]   = useState(false);
  const [messages, setMessages]       = useState<GeneratedMessages | null>(null);
  const [edited, setEdited]           = useState<GeneratedMessages>({});
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [feedback, setFeedback]       = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [genError, setGenError]       = useState<string | null>(null);

  // Buscar contactos
  useEffect(() => {
    if (!query.trim() || mode !== "search") { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/contacts?client_id=${clientId}&search=${encodeURIComponent(query)}&limit=6`);
      if (res.ok) {
        const d = await res.json();
        setSuggestions(d.contacts ?? []);
      }
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
    if (mode === "search" && selected) {
      payload.contact_id = selected.id;
    } else {
      payload.manual = manual;
    }
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
        contact_name:  contactName || undefined,
        job_title:     (selected?.job_title  ?? manual.jobTitle)   || undefined,
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
      {/* ── Panel izquierdo: selección ── */}
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
                  <button onClick={() => { setSelected(null); setQuery(""); }} className="ml-auto text-ink-muted hover:text-ink">
                    <IconX size={13} />
                  </button>
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
                <input
                  type="checkbox"
                  checked={manual.hasEmail}
                  onChange={(e) => setManual((p) => ({ ...p, hasEmail: e.target.checked }))}
                />
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

        {/* Feedback */}
        {messages && (
          <div className="card px-5 py-4 space-y-3">
            <p className="text-sm font-semibold text-ink">Feedback para mejorar</p>
            <p className="text-xs text-ink-muted">Explica qué cambiar y regenera con ese contexto.</p>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              placeholder="Ej: el subject es muy genérico, necesito algo más directo. El body es muy largo, reducilo a 3 oraciones…"
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

      {/* ── Panel derecho: resultado ── */}
      <div className="space-y-4">
        {genError && (
          <div className="card border-l-4 border-red-400 px-4 py-3 text-red-600 text-sm flex items-center gap-2">
            <IconAlertCircle size={14} /> {genError}
          </div>
        )}

        {!messages && !generating && (
          <EmptyState
            icon={<IconFlask size={48} />}
            text="Selecciona un contacto y genera los mensajes para ver el resultado aquí."
          />
        )}

        {generating && !messages && (
          <div className="card flex flex-col items-center justify-center py-16 gap-3">
            <IconLoader2 size={28} className="animate-spin" style={{ color: "#62E0D8" }} />
            <p className="text-sm text-ink-muted">Generando mensajes personalizados…</p>
          </div>
        )}

        {messages && (
          <div className="card px-5 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-ink text-sm">Mensajes generados</p>
              {regenerating && <IconLoader2 size={14} className="animate-spin text-ink-muted" />}
            </div>

            <MessageBlock
              label="Subject {{emailSubject}}"
              value={edited.emailSubject ?? ""}
              onChange={setField("emailSubject")}
            />
            <MessageBlock
              label="Email Body {{emailBody}}"
              value={edited.emailBody ?? ""}
              onChange={setField("emailBody")}
            />
            <MessageBlock
              label="LinkedIn Icebreaker {{icebreaker}}"
              value={edited.linkedinIcebreaker ?? ""}
              onChange={setField("linkedinIcebreaker")}
            />

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
              {saved ? "Guardado como ejemplo aprobado" : "Guardar como ejemplo aprobado"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TAB: Ejemplos aprobados ──────────────────────────────────────────────────

function ExamplesTab({ clientId }: { clientId: string }) {
  const [examples, setExamples] = useState<Example[]>([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/training/examples?client_id=${clientId}`);
    if (res.ok) setExamples((await res.json()).examples ?? []);
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

  if (!examples.length) return (
    <EmptyState
      icon={<IconStarFilled size={48} />}
      text="Aún no hay ejemplos. Genera mensajes en el Laboratorio y guárdalos aquí."
    />
  );

  const withReply = examples.filter((e) => e.had_reply).length;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex gap-3 flex-wrap">
        <div className="card px-4 py-3 text-center min-w-[110px]">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Total</div>
          <div className="text-2xl font-bold text-ink mt-0.5">{examples.length}</div>
          <div className="text-[11px] text-ink-muted">ejemplos</div>
        </div>
        <div className="card px-4 py-3 text-center min-w-[110px]">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Con reply</div>
          <div className="text-2xl font-bold mt-0.5" style={{ color: "#0F6E56" }}>{withReply}</div>
          <div className="text-[11px] text-ink-muted">funcionaron</div>
        </div>
        <div className="card px-4 py-3 flex-1 min-w-[200px]">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-2">Calidad del dataset</div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all"
              style={{
                width: `${examples.length ? Math.min((examples.length / 10) * 100, 100) : 0}%`,
                background: "#62E0D8",
              }}
            />
          </div>
          <div className="text-[11px] text-ink-muted mt-1">
            {examples.length < 3 ? "Necesitás al menos 3 ejemplos" : examples.length < 8 ? "Buen comienzo, seguí agregando" : "Excelente dataset"}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {examples.map((ex) => (
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
                      Tuvo reply
                    </span>
                  )}
                </div>
                {(ex.contact_name || ex.job_title || ex.company_name) && (
                  <div className="text-xs text-ink-muted mt-0.5">
                    {[ex.contact_name, ex.job_title, ex.company_name].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              {expanded === ex.id
                ? <IconChevronUp size={14} className="text-ink-muted shrink-0" />
                : <IconChevronDown size={14} className="text-ink-muted shrink-0" />
              }
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
        ))}
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
        Estas reglas se inyectan en el prompt de Claude cada vez que se generan mensajes. Cuanto más específico seas, más parecidos serán a cómo tú escribes.
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
        <p className="text-xs text-ink-muted">Describí el tono con el que querés sonar.</p>
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
        <p className="text-xs text-ink-muted">Una regla por línea. Cómo estructurás los mensajes.</p>
        <textarea
          value={style.rules}
          onChange={(e) => setStyle((p) => ({ ...p, rules: e.target.value }))}
          rows={5}
          placeholder={`Ej:\nSiempre abrí con algo específico de la empresa o el cargo.\nTerminá con una pregunta abierta, nunca con "¿Tenés 15 minutos?".\nEl subject nunca lleva signos de pregunta.\nNo usar "espero que estés bien" ni frases de relleno.`}
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
          placeholder={`Ej:\nespero que estés bien\ndisrupción / disruptivo\nsolución integral\n¿Tenés 15 minutos para una llamada?`}
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
  { id: "lab"      as Tab, label: "Laboratorio",        icon: <IconFlask size={16} />,       desc: "Genera y refina mensajes con feedback" },
  { id: "examples" as Tab, label: "Ejemplos aprobados", icon: <IconStarFilled size={16} />,  desc: "Tu biblioteca de mensajes que funcionan" },
  { id: "style"    as Tab, label: "Guía de estilo",     icon: <IconBrain size={16} />,       desc: "Tono, reglas y frases a evitar" },
];

export default function EntrenarModeloPage() {
  const { currentClient } = useClient();
  const [tab, setTab] = useState<Tab>("lab");

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
        <div className="label">Análisis · Configuración</div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconBrain size={22} style={{ color: "#62E0D8" }} /> Entrenar modelo
        </h1>
        <p className="text-sm text-ink-muted mt-0.5">
          Personalizá cómo escribe la IA para que suene exactamente como vos.
        </p>
      </header>

      {/* Tabs */}
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
        {tab === "lab"      && <LabTab      clientId={currentClient.id} />}
        {tab === "examples" && <ExamplesTab clientId={currentClient.id} />}
        {tab === "style"    && <StyleTab    clientId={currentClient.id} />}
      </div>
    </div>
  );
}
