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
  IconFileImport,
  IconChevronDown,
  IconSparkles,
  IconCopy,
  IconRefresh
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";
import {
  IcpFormData,
  EMPTY_FORM,
  TAMANO_OPTS, FACTURACION_OPTS, MODELO_OPTS, ETAPA_OPTS,
  DEPTO_OPTS, SENIORITY_OPTS, TONO_OPTS, IDIOMA_OPTS, CTA_OPTS, CANALES_OPTS,
  serializeIcpForm, deserializeIcpForm, parseFormJson
} from "@/lib/icp-form";

// ── Types ──────────────────────────────────────────────────────────────
type IcpDoc = {
  id: string;
  file_name: string;
  file_type: string;
  content: string;
  uploaded_at: string;
};

// ── Componente principal ───────────────────────────────────────────────
export default function IcpPage() {
  const { currentClient } = useClient();
  const [doc,      setDoc]      = useState<IcpDoc | null>(null);
  const [form,     setForm]     = useState<IcpFormData>(EMPTY_FORM);
  const [fileName, setFileName] = useState("ICP");
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedAt,  setSavedAt]  = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [magicLink,        setMagicLink]        = useState<string | null>(null);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [linkCopied,       setLinkCopied]       = useState(false);
  const [clayPrompt,       setClayPrompt]       = useState<string | null>(null);
  const [clayLoading,      setClayLoading]      = useState(false);
  const [clayCopied,       setClayCopied]       = useState(false);
  const [clayError,        setClayError]        = useState<string | null>(null);

  const [fpTitles,     setFpTitles]     = useState<string | null>(null);
  const [fpKeywords,   setFpKeywords]   = useState<string | null>(null);
  const [fpExcluded,   setFpExcluded]   = useState<string | null>(null);
  const [fpLocation,   setFpLocation]   = useState<string | null>(null);
  const [fpLoading,    setFpLoading]    = useState(false);
  const [fpError,      setFpError]      = useState<string | null>(null);
  const [fpCopied,     setFpCopied]     = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);

  function setField(key: keyof IcpFormData, value: string | string[]) {
    setForm((prev: IcpFormData) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  function toggleChip(key: keyof IcpFormData, value: string) {
    const current = form[key] as string[];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    setField(key, next);
  }

  async function load() {
    if (!currentClient) return;
    setLoading(true);
    setError(null);
    const [ctxRes, promptRes, fpRes] = await Promise.all([
      fetch(`/api/clients/${currentClient.id}/context`, { cache: "no-store" }),
      fetch(`/api/clients/${currentClient.id}/clay-scoring-prompt`, { cache: "no-store" }),
      fetch(`/api/clients/${currentClient.id}/generate-clay-config`, { cache: "no-store" }),
    ]);
    const j = await ctxRes.json();
    setLoading(false);
    if (j.error) { setError(j.error); return; }
    const icpDoc: IcpDoc | undefined = (j.items ?? []).find(
      (i: IcpDoc) => i.file_type === "icp"
    );
    setDoc(icpDoc ?? null);
    setFileName(icpDoc?.file_name ?? "ICP");
    setSavedAt(null);
    setForm(icpDoc?.content ? deserializeIcpForm(icpDoc.content) : EMPTY_FORM);
    if (promptRes.ok) {
      const pj = await promptRes.json();
      setClayPrompt(pj.prompt ?? null);
    }
    if (fpRes.ok) {
      const fj = await fpRes.json();
      setFpTitles(fj.find_people_titles ?? null);
      setFpKeywords(fj.find_people_keywords ?? null);
      setFpExcluded(fj.excluded_titles ?? null);
      setFpLocation(fj.location_filter ?? null);
    }
  }

  useEffect(() => { load(); }, [currentClient?.id]);

  async function generateClayPrompt(regenerate = false) {
    if (!currentClient) return;
    if (!regenerate && clayPrompt) return;
    setClayLoading(true);
    setClayError(null);
    const r = await fetch(`/api/clients/${currentClient.id}/clay-scoring-prompt`, { method: "POST" });
    const j = await r.json();
    setClayLoading(false);
    if (j.error) { setClayError(j.error); return; }
    setClayPrompt(j.prompt);
  }

  function copyClayPrompt() {
    if (!clayPrompt) return;
    navigator.clipboard.writeText(clayPrompt).then(() => {
      setClayCopied(true);
      setTimeout(() => setClayCopied(false), 2000);
    });
  }

  async function generateClayConfig() {
    if (!currentClient) return;
    setFpLoading(true);
    setFpError(null);
    const r = await fetch(`/api/clients/${currentClient.id}/generate-clay-config`, { method: "POST" });
    const j = await r.json();
    setFpLoading(false);
    if (j.error) { setFpError(j.error); return; }
    setFpTitles(j.find_people_titles ?? null);
    setFpKeywords(j.find_people_keywords ?? null);
    setFpExcluded(j.excluded_titles ?? null);
    setFpLocation(j.location_filter ?? null);
  }

  function copyFpField(value: string, key: string) {
    navigator.clipboard.writeText(value).then(() => {
      setFpCopied(key);
      setTimeout(() => setFpCopied(null), 2000);
    });
  }

  async function save() {
    if (!currentClient) return;
    const content = serializeIcpForm(form);
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
    const r = await fetch(`/api/clients/${currentClient.id}/context/${doc.id}`, { method: "DELETE" });
    setDeleting(false);
    if (r.ok) { setDoc(null); setForm(EMPTY_FORM); setFileName("ICP"); setSavedAt(null); }
  }

  // Importar TXT/DOCX/PDF con el formato de texto del ICP
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const baseName = file.name.replace(/\.[^.]+$/, "");
    if (ext === "txt" || ext === "md") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = (ev.target?.result as string) ?? "";
        setForm(deserializeIcpForm(text));
        setFileName(baseName);
        setSavedAt(null);
      };
      reader.readAsText(file, "utf-8");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    const r = await fetch("/api/parse-document", { method: "POST", body: formData });
    const j = await r.json();
    if (j.error) { setError(`Error al leer el archivo: ${j.error}`); return; }
    setForm(deserializeIcpForm(j.text ?? ""));
    setFileName(baseName);
    setSavedAt(null);
  }

  // Importar JSON exportado desde el formulario HTML del cliente
  async function handleJsonImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse((ev.target?.result as string) ?? "{}");
        if (json.source !== "bullseye-icp-form-v3") {
          setError("El archivo no parece ser un formulario ICP de BullsEye. Verifica que hayas exportado desde el formulario correcto.");
          return;
        }
        const parsed = parseFormJson(json);
        setForm(parsed);
        const empresa = parsed.nombre_empresa?.trim();
        if (empresa) setFileName(`ICP — ${empresa}`);
        setSavedAt(null);
      } catch {
        setError("El archivo JSON no es válido. Asegúrate de exportarlo desde el formulario ICP.");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  async function generateMagicLink() {
    if (!currentClient) return;
    setMagicLinkLoading(true);
    const r = await fetch(`/api/clients/${currentClient.id}/form-token`);
    const j = await r.json();
    setMagicLinkLoading(false);
    if (j.error) { setError(j.error); return; }
    const url: string = j.url;
    setMagicLink(url);
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    });
  }

  const hasContent = Object.values(form).some((v) =>
    Array.isArray(v) ? v.length > 0 : (v as string).trim().length > 0
  );

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

          {/* Link mágico para que el cliente rellene el formulario directamente */}
          <button
            className="btn-secondary py-1.5 px-3"
            onClick={generateMagicLink}
            disabled={magicLinkLoading}
            title="Genera un link único para que el cliente rellene el ICP. Al guardar, se actualiza directamente en la app."
          >
            {magicLinkLoading ? (
              <><IconLoader2 size={15} className="animate-spin" /> Generando…</>
            ) : linkCopied ? (
              <><IconCheck size={15} /> ¡Link copiado!</>
            ) : (
              <><IconSparkles size={15} /> Link mágico</>
            )}
          </button>

          {/* Importar respuestas JSON del cliente */}
          <button
            className="btn-secondary py-1.5 px-3"
            onClick={() => jsonRef.current?.click()}
            title="Importa el JSON exportado por el cliente desde el formulario HTML"
          >
            <IconFileImport size={15} /> Importar respuestas
          </button>

          {doc && (
            <button
              className="btn-secondary py-1.5 px-2 text-danger-fg"
              onClick={remove}
              disabled={deleting}
              title="Eliminar ICP"
            >
              {deleting ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                <IconTrash size={14} />
              )}
            </button>
          )}

          <button
            className="btn-secondary py-1.5 px-3"
            onClick={() => fileRef.current?.click()}
            title="Sube un TXT, DOCX o PDF con el ICP en formato de texto"
          >
            <IconUpload size={15} /> Subir archivo
          </button>

          <button
            className="btn-primary"
            onClick={save}
            disabled={saving || !hasContent}
          >
            {saving ? (
              <IconLoader2 size={15} className="animate-spin" />
            ) : (
              <IconDeviceFloppy size={15} />
            )}
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </header>

      <input ref={fileRef} type="file" accept=".txt,.md,.docx,.doc,.pdf" className="hidden" onChange={handleFile} />
      <input ref={jsonRef} type="file" accept=".json" className="hidden" onChange={handleJsonImport} />

      {error && (
        <div className="card border border-danger-bg text-danger-fg flex items-center gap-2 text-sm">
          <IconAlertCircle size={16} className="shrink-0" /> {error}
          <button className="ml-auto" onClick={() => setError(null)}>
            <IconX size={14} />
          </button>
        </div>
      )}

      {/* Banner explicativo de las dos opciones */}
      <div className="card py-3 px-4 space-y-2 text-sm" style={{ background: "rgba(37,23,98,0.04)", border: "1px solid rgba(37,23,98,0.1)" }}>
        <p className="font-medium text-ink">Dos maneras de completar el ICP:</p>
        <p className="text-ink-muted text-xs">
          <span className="font-semibold text-ink">① Directo aquí</span> — Completa las secciones abajo y haz clic en Guardar.
        </p>
        <p className="text-ink-muted text-xs">
          <span className="font-semibold text-ink">② Link mágico</span> — Haz clic en{" "}
          <span className="font-semibold text-ink">Link mágico</span> (arriba), el link se copia automáticamente. Envíaselo al cliente. Cuando haga clic en{" "}
          <span className="font-semibold text-ink">Guardar</span> en el formulario, el ICP se actualiza aquí directamente, sin exportar nada.
        </p>
        {magicLink && (
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <code className="text-[11px] bg-white border border-[rgba(37,23,98,0.15)] rounded px-2 py-0.5 text-ink-muted break-all">
              {magicLink}
            </code>
            <button
              className="text-[11px] text-accent hover:underline shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(magicLink);
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2500);
              }}
            >
              {linkCopied ? "¡Copiado!" : "Copiar"}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="card flex items-center gap-3 text-ink-muted">
          <IconLoader2 size={18} className="animate-spin" /> Cargando ICP…
        </div>
      ) : (
        <div className="space-y-4">
          {/* Nombre del documento */}
          <div className="card py-3">
            <div className="flex items-center gap-3">
              <IconFileText size={15} className="text-ink-subtle shrink-0" />
              <input
                className="input flex-1"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="Nombre del documento ICP"
              />
            </div>
          </div>

          {/* ── Sección 1: Datos del cliente ── */}
          <IcpSection num={1} title="DATOS DEL CLIENTE" desc="Información básica del contacto y la empresa">
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Nombre de la empresa"  value={form.nombre_empresa}  onChange={(v) => setField("nombre_empresa",  v)} placeholder="Ej: Acme Corp" />
              <TextField label="Nombre del contacto"   value={form.nombre_contacto} onChange={(v) => setField("nombre_contacto", v)} placeholder="Nombre completo" />
              <TextField label="Cargo"                 value={form.cargo}           onChange={(v) => setField("cargo",           v)} placeholder="Ej: Head of Sales, CEO" />
              <TextField label="Email de contacto"     value={form.email}           onChange={(v) => setField("email",           v)} placeholder="email@empresa.com" />
            </div>
            <TextArea
              label="Descripción breve del negocio"
              hint="¿A qué se dedica la empresa? ¿Cuál es su producto o servicio principal?"
              rows={3}
              placeholder="Ej: Somos una plataforma SaaS de gestión de RRHH para empresas medianas en LATAM."
              value={form.descripcion_negocio}
              onChange={(v) => setField("descripcion_negocio", v)}
            />
          </IcpSection>

          {/* ── Sección 2: Perfil de empresa objetivo ── */}
          <IcpSection num={2} title="PERFIL DE EMPRESA OBJETIVO (ICP)" desc="Define el tipo ideal de cliente">
            <TextArea
              label="Industrias objetivo" crit
              hint="Lista en orden de prioridad. Sé específico (no 'tecnología' sino 'SaaS B2B de RRHH')"
              rows={4} placeholder={"1. SaaS B2B con equipo comercial (prioridad alta)\n2. Agencias de marketing con equipo propio\n3. ..."}
              value={form.industrias_objetivo} onChange={(v) => setField("industrias_objetivo", v)}
            />
            <TextArea
              label="Industrias excluidas" crit
              hint="Sectores donde tu solución NO aplica o has tenido malas experiencias"
              rows={3} placeholder={"- Retail B2C\n- Startups pre-revenue\n- ..."}
              value={form.industrias_excluidas} onChange={(v) => setField("industrias_excluidas", v)}
            />
            <div className="grid grid-cols-2 gap-3">
              <ChipGroup label="Tamaño de empresa (empleados)" options={TAMANO_OPTS}    selected={form.tamano_empresa} onToggle={(v) => toggleChip("tamano_empresa", v)} multi />
              <ChipGroup label="Facturación anual estimada"    options={FACTURACION_OPTS} selected={form.facturacion}    onToggle={(v) => toggleChip("facturacion",    v)} multi />
            </div>
            <TextArea
              label="Geografías prioritarias" crit
              hint="Países, regiones o ciudades en orden de prioridad"
              rows={3} placeholder={"1. Chile (RM + Valparaíso)\n2. México (CDMX)\n3. ..."}
              value={form.geografias} onChange={(v) => setField("geografias", v)}
            />
            <div className="grid grid-cols-2 gap-3">
              <ChipGroup label="Modelo de empresa" options={MODELO_OPTS} selected={form.modelo_empresa} onToggle={(v) => toggleChip("modelo_empresa", v)} multi />
              <ChipGroup label="Etapa de la empresa" options={ETAPA_OPTS} selected={form.etapa_empresa} onToggle={(v) => toggleChip("etapa_empresa", v)} multi />
            </div>
          </IcpSection>

          {/* ── Sección 3: Señales de fit ── */}
          <IcpSection num={3} title="SEÑALES DE FIT" desc="El equipo BullsEye busca estas señales en LinkedIn, web y noticias">
            <TextArea
              label="Señales positivas de fit" crit
              hint="¿Qué indica que una empresa NECESITA tu solución? Sé lo más específico posible."
              rows={5} placeholder={"1. Tienen equipo de ventas de 3+ personas\n2. Usan HubSpot o Salesforce\n3. Publicaron vacante de SDR en los últimos 90 días\n4. ..."}
              value={form.senales_positivas} onChange={(v) => setField("senales_positivas", v)}
            />
            <TextArea
              label="Señales negativas / descalificadores" crit
              hint="¿Qué descalifica a una empresa automáticamente?"
              rows={4} placeholder={"1. Solo tienen 1 vendedor\n2. Venden a consumidores finales (B2C)\n3. ..."}
              value={form.senales_negativas} onChange={(v) => setField("senales_negativas", v)}
            />
            <TextArea
              label="Tech stack / herramientas que usa tu cliente ideal"
              hint="Indica madurez digital y alineación con tu solución"
              rows={3} placeholder={"CRM: HubSpot, Salesforce\nAutomatización: Outreach, Apollo\nVideoconferencia: Zoom, Teams"}
              value={form.tech_stack} onChange={(v) => setField("tech_stack", v)}
            />
            <TextArea
              label="Eventos disparadores de compra"
              hint="¿Qué evento hace que busquen tu solución?"
              rows={3} placeholder={"- Expansión a nuevo mercado\n- Contratación de nuevo VP de Ventas\n- Ronda de inversión reciente"}
              value={form.eventos_disparadores} onChange={(v) => setField("eventos_disparadores", v)}
            />
          </IcpSection>

          {/* ── Sección 4: Buyer persona ── */}
          <IcpSection num={4} title="BUYER PERSONA — EL CONTACTO QUE CIERRA" desc="A quién contactar dentro de la empresa y cómo piensa">
            <TextArea
              label="Cargos decisores (quien aprueba)" crit
              hint="Los que firman el contrato"
              rows={3} placeholder={"1. CEO / Founder\n2. VP de Ventas / Chief Revenue Officer\n3. ..."}
              value={form.cargos_decisores} onChange={(v) => setField("cargos_decisores", v)}
            />
            <TextArea
              label="Cargos influenciadores (quien recomienda)"
              hint="Abren la puerta pero no aprueban"
              rows={3} placeholder={"1. Sales Manager / Jefe de ventas\n2. Revenue Ops Manager\n3. ..."}
              value={form.cargos_influenciadores} onChange={(v) => setField("cargos_influenciadores", v)}
            />
            <TextArea
              label="Cargos a evitar" crit
              hint="Sin poder de compra o bloquean el proceso"
              rows={2} placeholder={"- Pasantes / becarios\n- IT / Sistemas (solo si no tienen influencia en ventas)"}
              value={form.cargos_evitar} onChange={(v) => setField("cargos_evitar", v)}
            />
            <div className="grid grid-cols-2 gap-3">
              <ChipGroup label="Departamentos objetivo" options={DEPTO_OPTS}     selected={form.departamentos} onToggle={(v) => toggleChip("departamentos", v)} multi />
              <ChipGroup label="Seniority mínimo"       options={SENIORITY_OPTS} selected={form.seniority}     onToggle={(v) => toggleChip("seniority",     v)} multi />
            </div>
            <TextArea
              label="Perfil psicográfico del buyer"
              hint="¿Cómo piensa? ¿Qué le quita el sueño? ¿Compra por ROI, referidos, innovación?"
              rows={4} placeholder={"Ej: Orientado a métricas, necesita justificar ROI ante el CEO, le frustra el time-to-value largo de otras herramientas..."}
              value={form.perfil_psicografico} onChange={(v) => setField("perfil_psicografico", v)}
            />
          </IcpSection>

          {/* ── Sección 5: Propuesta de valor ── */}
          <IcpSection num={5} title="PROPUESTA DE VALOR Y DIFERENCIADORES" desc="Para construir mensajes que resuenen con el contexto real del negocio">
            <TextArea
              label="Propuesta de valor en 1–2 oraciones" crit
              hint="Sin jerga interna. ¿Qué hace tu solución, para quién, con qué resultado?"
              rows={3} placeholder={"Ej: Ayudamos a empresas B2B con equipos de ventas de 5–30 personas a generar más reuniones calificadas en menos tiempo, sin depender de referidos."}
              value={form.propuesta_valor} onChange={(v) => setField("propuesta_valor", v)}
            />
            <TextArea
              label="Top 3 problemas que resuelves" crit
              rows={4} placeholder={"1. El equipo de ventas pierde tiempo en leads no calificados\n2. No tienen proceso de outbound estructurado\n3. ..."}
              value={form.problemas} onChange={(v) => setField("problemas", v)}
            />
            <TextArea
              label="Top 3 resultados que entregas"
              hint="Con números si los tienes"
              rows={4} placeholder={"1. +40% en reuniones calificadas en el primer mes\n2. Pipeline predecible desde semana 3\n3. ..."}
              value={form.resultados} onChange={(v) => setField("resultados", v)}
            />
            <TextArea
              label="Principales competidores"
              rows={3} placeholder={"Directos: Empresa A, Empresa B\nIndirectos: Agencias de marketing, contratar SDR interno"}
              value={form.competidores} onChange={(v) => setField("competidores", v)}
            />
            <TextArea
              label="Por qué te eligen vs. la competencia"
              hint="Lo que dicen tus mejores clientes, no tu marketing"
              rows={3} placeholder={"Ej: 'Nos eligieron porque combinamos estrategia + ejecución. No son solo una herramienta.'"}
              value={form.diferenciadores} onChange={(v) => setField("diferenciadores", v)}
            />
          </IcpSection>

          {/* ── Sección 6: Outreach ── */}
          <IcpSection num={6} title="OUTREACH — TONO Y MENSAJES" desc="Cómo comunicar para generar conversaciones reales">
            <div className="grid grid-cols-2 gap-3">
              <ChipGroup label="Tono de comunicación" crit options={TONO_OPTS}   selected={form.tono}   onToggle={(v) => toggleChip("tono",   v)} />
              <ChipGroup label="Idioma del outreach"       options={IDIOMA_OPTS} selected={form.idioma} onToggle={(v) => toggleChip("idioma", v)} multi />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ChipGroup label="CTA del primer contacto" options={CTA_OPTS}     selected={form.cta_primer_contacto} onToggle={(v) => toggleChip("cta_primer_contacto", v)} />
              <ChipGroup label="Canales preferidos"      options={CANALES_OPTS} selected={form.canales}             onToggle={(v) => toggleChip("canales",             v)} multi />
            </div>
            <TextArea
              label="Mensajes que han funcionado (ejemplos reales)"
              hint="Pega 1–2 emails o mensajes LinkedIn que generaron respuesta positiva. Sin datos personales."
              rows={6} placeholder={"Ejemplo email que funcionó:\nAsunto: [Nombre empresa] + prospección personalizada\nHola [Nombre], vi que están contratando SDRs en LinkedIn..."}
              value={form.mensajes_exitosos} onChange={(v) => setField("mensajes_exitosos", v)}
            />
            <TextArea
              label="Objeciones frecuentes y cómo responderlas"
              hint="Las que aparecen antes de la primera llamada"
              rows={4} placeholder={"'Ya tenemos una agencia' → ...\n'No tenemos presupuesto' → ...\n'Mándame información por email' → ..."}
              value={form.objeciones} onChange={(v) => setField("objeciones", v)}
            />
          </IcpSection>

          {/* ── Sección 7: Clientes de referencia ── */}
          <IcpSection num={7} title="CLIENTES ACTUALES COMO REFERENCIA" desc="Los mejores clientes son la mejor referencia para el equipo BullsEye">
            <TextArea
              label="Top 3–5 mejores clientes actuales o pasados" crit
              hint="Nombre/tipo, industria, tamaño, por qué fueron tan buenos clientes."
              rows={5} placeholder={"1. Empresa A — SaaS B2B RRHH, 80 empleados — pagaron sin negociar, escalaron a plan mayor\n2. Empresa B — Fintech, 200 emp. — compra por ROI, ciclo de venta rápido\n3. ..."}
              value={form.mejores_clientes} onChange={(v) => setField("mejores_clientes", v)}
            />
            <div className="grid grid-cols-2 gap-3">
              <TextArea
                label="Peores clientes / mal fit"
                hint="¿Qué tenían en común? ¿Qué señales ignoraste?"
                rows={4} placeholder={"1. Fundador que hace todo solo\n2. Sector muy regulado, ciclo > 6 meses\n3. ..."}
                value={form.peores_clientes} onChange={(v) => setField("peores_clientes", v)}
              />
              <TextArea
                label="Ticket / ACV y ciclo de venta"
                hint="Valor anual del contrato y tiempo desde primer contacto a cierre"
                rows={4} placeholder={"Ticket mínimo: $X/mes\nTicket promedio: $X/mes\n\nCiclo típico: X semanas\nCiclo warm lead: X días"}
                value={form.ticket_acv} onChange={(v) => setField("ticket_acv", v)}
              />
            </div>
          </IcpSection>

          {doc && (
            <p className="text-xs text-ink-subtle">
              Última actualización:{" "}
              {new Date(doc.uploaded_at).toLocaleDateString("es", {
                day: "2-digit", month: "short", year: "numeric",
              })}
            </p>
          )}
        </div>
      )}

      {/* ── Clay Find People ── */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #E5E2F0" }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ background: "#251762" }}>
          <div className="flex items-center gap-3">
            <span
              className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
              style={{ background: "#62E0D8", color: "#251762" }}
            >
              ⬡
            </span>
            <div>
              <div className="font-semibold text-sm text-white tracking-wide">CLAY — FIND PEOPLE</div>
              <div className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                Cargos, keywords y exclusiones listos para pegar en Clay Find People
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(fpTitles || fpKeywords || fpExcluded || fpLocation) && (
              <button
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{ background: "rgba(98,224,216,0.15)", color: "#62E0D8", border: "1px solid rgba(98,224,216,0.3)" }}
                onClick={generateClayConfig}
                disabled={fpLoading}
              >
                <IconRefresh size={13} className={fpLoading ? "animate-spin" : ""} />
                Regenerar
              </button>
            )}
            {!(fpTitles || fpKeywords || fpExcluded || fpLocation) && (
              <button
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{ background: "#62E0D8", color: "#251762" }}
                onClick={generateClayConfig}
                disabled={fpLoading || !doc}
              >
                {fpLoading
                  ? <><IconLoader2 size={13} className="animate-spin" /> Generando…</>
                  : <><IconSparkles size={13} /> Generar configuración Clay</>}
              </button>
            )}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {!doc && (
            <p className="text-sm text-ink-muted text-center py-3">
              Carga el ICP primero para generar la configuración de Clay.
            </p>
          )}

          {doc && fpLoading && !(fpTitles || fpKeywords || fpExcluded || fpLocation) && (
            <div className="flex items-center gap-3 text-sm text-ink-muted py-4 justify-center">
              <IconLoader2 size={18} className="animate-spin" style={{ color: "#251762" }} />
              Generando configuración con Claude…
            </div>
          )}

          {fpError && (
            <div className="flex items-center gap-2 text-sm text-danger-fg">
              <IconAlertCircle size={14} className="shrink-0" /> {fpError}
            </div>
          )}

          {doc && !fpLoading && !(fpTitles || fpKeywords || fpExcluded || fpLocation) && !fpError && (
            <p className="text-sm text-ink-muted text-center py-3">
              Genera los valores para configurar Clay Find People basándote en el ICP de{" "}
              <span className="font-medium text-ink">{currentClient?.name}</span>.
            </p>
          )}

          {(fpTitles || fpKeywords || fpExcluded || fpLocation) && (
            <div className="space-y-4">
              {[
                {
                  key:   "titles",
                  label: "Cargos para Find People",
                  hint:  "Clay → tabla Companies → Find People → campo \"Job titles\" — pega esta lista",
                  value: fpTitles,
                },
                {
                  key:   "keywords",
                  label: "Keywords de búsqueda",
                  hint:  "Clay → Find People → campo \"Keywords\" — complementan los cargos para ampliar la búsqueda",
                  value: fpKeywords,
                },
                {
                  key:   "excluded",
                  label: "Cargos a excluir",
                  hint:  "Clay → Find People → campo \"Excluded job titles\" — cargos sin poder de compra",
                  value: fpExcluded,
                },
                {
                  key:   "location",
                  label: "Geografías para Find People",
                  hint:  "Clay → tabla Companies → Find People → Location → pega esta lista",
                  value: fpLocation,
                },
              ].map(({ key, label, hint, value }) => value && (
                <div key={key}>
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div>
                      <p className="text-xs font-semibold text-ink">{label}</p>
                      <p className="text-[11px] text-ink-muted mt-0.5">{hint}</p>
                    </div>
                    <button
                      className="btn-secondary py-1 px-3 text-xs shrink-0 flex items-center gap-1.5"
                      onClick={() => copyFpField(value, key)}
                    >
                      {fpCopied === key
                        ? <><IconCheck size={13} /> ¡Copiado!</>
                        : <><IconCopy size={13} /> Copiar</>}
                    </button>
                  </div>
                  <textarea
                    className="input w-full font-mono text-xs leading-relaxed"
                    rows={3}
                    readOnly
                    value={value}
                    style={{ resize: "vertical", background: "#FAFAFA" }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Clay Lead Scoring ── */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #E5E2F0" }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ background: "#251762" }}>
          <div className="flex items-center gap-3">
            <span
              className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
              style={{ background: "#62E0D8", color: "#251762" }}
            >
              ⬡
            </span>
            <div>
              <div className="font-semibold text-sm text-white tracking-wide">CLAY — LEAD SCORING AI</div>
              <div className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                Prompt listo para pegar en la columna Lead Scoring AI de Clay
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {clayPrompt && (
              <button
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                style={{ background: "rgba(98,224,216,0.15)", color: "#62E0D8", border: "1px solid rgba(98,224,216,0.3)" }}
                onClick={() => generateClayPrompt(true)}
                disabled={clayLoading}
                title="Regenerar prompt desde el ICP actualizado"
              >
                <IconRefresh size={13} className={clayLoading ? "animate-spin" : ""} />
                Regenerar
              </button>
            )}
            {!clayPrompt && (
              <button
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                style={{ background: "#62E0D8", color: "#251762" }}
                onClick={() => generateClayPrompt(false)}
                disabled={clayLoading}
              >
                {clayLoading
                  ? <><IconLoader2 size={13} className="animate-spin" /> Generando…</>
                  : <><IconSparkles size={13} /> Generar prompt</>}
              </button>
            )}
          </div>
        </div>

        <div className="p-5 space-y-3">
          {clayLoading && !clayPrompt && (
            <div className="flex items-center gap-3 text-sm text-ink-muted py-4 justify-center">
              <IconLoader2 size={18} className="animate-spin" style={{ color: "#251762" }} />
              Generando prompt optimizado con Claude…
            </div>
          )}

          {clayError && (
            <div className="flex items-center gap-2 text-sm text-danger-fg">
              <IconSparkles size={14} className="shrink-0" /> {clayError}
            </div>
          )}

          {clayPrompt && (
            <>
              <div
                className="text-xs rounded-lg px-3 py-2 flex items-start gap-2"
                style={{ background: "rgba(98,224,216,0.08)", border: "1px solid rgba(98,224,216,0.2)", color: "#0E7A73" }}
              >
                <IconSparkles size={13} className="shrink-0 mt-0.5" />
                <span>
                  Pega este prompt en la columna <strong>Lead Scoring AI</strong> de Clay en la tabla{" "}
                  <strong>Contacts — {currentClient?.name}</strong>
                </span>
              </div>

              <textarea
                className="input w-full font-mono text-xs leading-relaxed"
                rows={14}
                readOnly
                value={clayPrompt}
                style={{ resize: "vertical", background: "#FAFAFA" }}
              />

              <div className="flex items-center gap-2">
                <button
                  className="btn-primary py-1.5 px-4"
                  onClick={copyClayPrompt}
                >
                  {clayCopied
                    ? <><IconCheck size={14} /> ¡Copiado!</>
                    : <><IconCopy size={14} /> Copiar prompt</>}
                </button>
                <button
                  className="btn-secondary py-1.5 px-4"
                  onClick={() => generateClayPrompt(true)}
                  disabled={clayLoading}
                >
                  <IconRefresh size={14} className={clayLoading ? "animate-spin" : ""} />
                  {clayLoading ? "Regenerando…" : "Regenerar"}
                </button>
              </div>
            </>
          )}

          {!clayPrompt && !clayLoading && !clayError && (
            <div className="text-sm text-ink-muted text-center py-4">
              Genera el prompt para calificar leads automáticamente en Clay basándote en el ICP de{" "}
              <span className="font-medium text-ink">{currentClient?.name}</span>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Bloque de sección colapsable ───────────────────────────────────────
function IcpSection({
  num, title, desc, children
}: {
  num: number; title: string; desc: string; children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #E5E2F0" }}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        style={{ background: "#251762" }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-3">
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
            style={{ background: "#62E0D8", color: "#251762" }}
          >
            {num}
          </span>
          <div>
            <div className="font-semibold text-sm text-white tracking-wide">{title}</div>
            <div className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>{desc}</div>
          </div>
        </div>
        <IconChevronDown
          size={16}
          style={{
            color: "#62E0D8",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        />
      </button>
      {!collapsed && (
        <div className="p-5 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Campo de texto simple ──────────────────────────────────────────────
function TextField({
  label, value, onChange, placeholder
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-ink mb-1.5">{label}</div>
      <input
        type="text"
        className="input w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

// ── Campo de texto largo ───────────────────────────────────────────────
function TextArea({
  label, value, onChange, rows = 3, placeholder, hint, crit
}: {
  label: string; value: string; onChange: (v: string) => void;
  rows?: number; placeholder?: string; hint?: string; crit?: boolean;
}) {
  return (
    <label className="block">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink mb-1">
        {label}
        {crit && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
            style={{ background: "rgba(37,23,98,0.08)", color: "#251762", border: "1px solid rgba(37,23,98,0.15)" }}
          >
            Crítico
          </span>
        )}
      </div>
      {hint && <div className="text-[11px] text-ink-muted mb-1.5 leading-snug">{hint}</div>}
      <textarea
        rows={rows}
        className="input w-full resize-y"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

// ── Grupo de chips ─────────────────────────────────────────────────────
function ChipGroup({
  label, options, selected, onToggle, multi, crit
}: {
  label: string; options: string[]; selected: string[];
  onToggle: (v: string) => void; multi?: boolean; crit?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold text-ink mb-2">
        {label}
        {crit && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
            style={{ background: "rgba(37,23,98,0.08)", color: "#251762", border: "1px solid rgba(37,23,98,0.15)" }}
          >
            Crítico
          </span>
        )}
        {!multi && <span className="text-[10px] text-ink-subtle font-normal">(elige uno)</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => {
                if (!multi) {
                  onToggle(opt);
                } else {
                  onToggle(opt);
                }
              }}
              className="px-3 py-1 rounded-full text-xs font-medium transition-all"
              style={
                active
                  ? { background: "#251762", color: "#fff", border: "1.5px solid #251762" }
                  : { background: "#F1EEF7", color: "#4A4E6B", border: "1.5px solid transparent" }
              }
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
