"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useClient } from "@/lib/clientContext";
import {
  IconArrowLeft, IconArrowRight, IconCheck, IconX,
  IconLoader2, IconAlertTriangle, IconCopy, IconWand,
  IconPhoto, IconUpload, IconRefresh, IconRocket,
} from "@tabler/icons-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type ClientData = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  is_active: boolean;
  status: string;
  onboarding_step: number;
  onboarding_completed_at: string | null;
  description: string | null;
  hubspot_owner_id: string | null;
  clay_companies_webhook_url: string | null;
  clay_contacts_webhook_url: string | null;
};

type ConfigData = {
  lemlist_campaign_id: string | null;
  lemlist_staging_campaign_id: string | null;
  hubspot_owner_id: string | null;
};

type VerifyStatus = "idle" | "loading" | "ok" | "error";

// ─── Constants ───────────────────────────────────────────────────────────────

const STEP_LABELS = ["Datos básicos", "ICP", "HubSpot", "Clay", "Lemlist", "Activación"];

const PROD_URL = "https://bullseye-abm-platform-eq6f.vercel.app";

const COMPANIES_BODY = `{
  "company_table_data": "<chip: Company Table Data>",
  "first_name": "<chip: First Name>",
  "last_name": "<chip: Last Name>",
  "job_title": "<chip: Job Title>",
  "linkedin_url": "<chip: LinkedIn URL>",
  "email": "<chip: Email>"
}`;

const CONTACTS_BODY = `{
  "bullseye_contact_id": "<chip: Bullseye Contact Id>",
  "fit_score": "<chip: Fit Score>",
  "fit": "<chip: Fit>",
  "fit_reason": "<chip: Fit Reason>",
  "fit_action": "<chip: Fit Action>"
}`;

const CRITICAL_SECTIONS = ["industrias", "señales", "buyer_persona", "propuesta_valor"];

const SECTION_LABELS: Record<string, string> = {
  industrias: "Industrias objetivo",
  señales: "Señales de fit",
  buyer_persona: "Buyer Persona",
  propuesta_valor: "Propuesta de valor",
  geografias: "Geografías",
  tamaño: "Tamaño de empresa",
  competidores: "Competidores",
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function slugify(text: string) {
  return text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function parseICPText(text: string): Record<string, string> {
  const patterns: [string, string[]][] = [
    ["industrias",     ["industrias objetivo", "target industries", "industries"]],
    ["señales",        ["señales de fit", "fit signals", "señales"]],
    ["buyer_persona",  ["buyer persona", "perfil del comprador", "buyer profile"]],
    ["propuesta_valor",["propuesta de valor", "value proposition"]],
    ["geografias",     ["geografías", "geografias", "geographies", "regions"]],
    ["tamaño",         ["tamaño de empresa", "company size"]],
    ["competidores",   ["competidores", "competitors", "competition"]],
  ];
  const lines = text.split("\n");
  const sections: Record<string, string> = {};
  let current: string | null = null;
  let buffer: string[] = [];
  const flush = () => { if (current) sections[current] = buffer.join("\n").trim(); };
  for (const line of lines) {
    const low = line.toLowerCase().trim();
    let found: string | null = null;
    for (const [key, pats] of patterns) {
      if (pats.some((p) => low.includes(p))) { found = key; break; }
    }
    if (found) { flush(); current = found; buffer = []; }
    else if (current) buffer.push(line);
  }
  flush();
  return sections;
}

// ─── Shared UI ───────────────────────────────────────────────────────────────

function WizardStepper({
  current, completed, onStepClick,
}: { current: number; completed: number; onStepClick: (n: number) => void }) {
  return (
    <div className="flex items-center mb-8 overflow-x-auto pb-1">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const done = n <= completed;
        const active = n === current;
        const clickable = n <= completed + 1;
        return (
          <div key={n} className="flex items-center">
            <button
              className="flex flex-col items-center focus:outline-none"
              onClick={() => clickable && onStepClick(n)}
              disabled={!clickable}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                style={{
                  background: done && !active ? "#62E0D8" : active ? "transparent" : "rgba(37,23,98,0.08)",
                  border: active ? "2px solid #251762" : done ? "none" : "2px solid #d1d5db",
                  color: done && !active ? "#251762" : active ? "#251762" : "#9ca3af",
                }}
              >
                {done && !active ? <IconCheck size={13} /> : n}
              </div>
              <span className="text-xs mt-1 whitespace-nowrap"
                style={{ color: active ? "#251762" : done ? "#6b7280" : "#9ca3af", fontWeight: active ? 600 : 400 }}>
                {label}
              </span>
            </button>
            {i < STEP_LABELS.length - 1 && (
              <div className="h-0.5 mx-2 shrink-0"
                style={{ width: 24, background: done ? "#62E0D8" : "#e5e7eb", marginBottom: 20 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CopyBlock({ content, label }: { content: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      {label && <p className="text-xs text-ink-muted mb-1 font-medium">{label}</p>}
      <pre className="rounded-lg p-3 text-xs overflow-x-auto leading-relaxed pr-16"
        style={{ background: "#1e1e2e", color: "#cdd6f4" }}>
        {content}
      </pre>
      <button
        onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="absolute top-2 right-2 text-xs px-2 py-0.5 rounded font-medium flex items-center gap-1"
        style={{ background: copied ? "#62E0D8" : "rgba(255,255,255,0.12)", color: copied ? "#251762" : "#cdd6f4" }}
      >
        <IconCopy size={10} />{copied ? "✓" : "Copiar"}
      </button>
    </div>
  );
}

function StatusIcon({ s }: { s: VerifyStatus }) {
  if (s === "loading") return <IconLoader2 size={16} className="animate-spin text-ink-muted" />;
  if (s === "ok") return <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(98,224,216,0.2)" }}><IconCheck size={12} style={{ color: "#62E0D8" }} /></span>;
  if (s === "error") return <span className="w-5 h-5 rounded-full flex items-center justify-center bg-red-100"><IconX size={12} className="text-red-500" /></span>;
  return <span className="w-5 h-5 rounded-full bg-gray-200 inline-block" />;
}

// ─── Step 1: Datos básicos (editar cliente existente) ────────────────────────

function Step1({ client, onComplete }: { client: ClientData; onComplete: (c: ClientData) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(client.name);
  const [slug, setSlug] = useState(client.slug);
  const [logoUrl, setLogoUrl] = useState(client.logo_url ?? "");
  const [logoError, setLogoError] = useState<string | null>(null);
  const [description, setDescription] = useState(client.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    if (file.size > 500 * 1024) { setLogoError(`${(file.size / 1024).toFixed(0)} KB — máximo 500 KB.`); return; }
    setLogoError(null);
    const reader = new FileReader();
    reader.onload = ev => setLogoUrl((ev.target?.result as string) ?? "");
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!name.trim() || !slug.trim()) return;
    setSaving(true); setError(null);
    const res = await fetch(`/api/clients/${client.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(), slug, logo_url: logoUrl || null,
        description: description.trim() || null,
        onboarding_step: Math.max(client.onboarding_step, 1),
      }),
    });
    const j = await res.json();
    if (j.error) { setError(j.error); setSaving(false); return; }
    onComplete(j.client);
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-danger-fg text-sm bg-danger-bg rounded-lg px-3 py-2">{error}</p>}
      <div>
        <label className="label block mb-1">Nombre del cliente *</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Clínica Dental Norte" />
      </div>
      <div>
        <label className="label block mb-1">Slug (URL)</label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-muted select-none">/clientes/</span>
          <input className="input" value={slug} onChange={e => setSlug(slugify(e.target.value))} />
        </div>
      </div>
      <div>
        <label className="label block mb-1">Logo — opcional</label>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
            style={{ background: logoUrl ? "transparent" : "rgba(37,23,98,0.08)", border: "1px dashed #c8c3dc" }}>
            {logoUrl ? <img src={logoUrl} alt="" className="w-full h-full object-cover" /> : <IconPhoto size={20} className="text-ink-subtle" />}
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex gap-2">
              <button type="button" className="btn-secondary py-1.5 px-3 text-sm flex items-center gap-1.5" onClick={() => fileRef.current?.click()}>
                <IconUpload size={13} /> Subir PNG / JPG
              </button>
              {logoUrl && <button type="button" className="btn-secondary py-1.5 px-2 text-danger-fg" onClick={() => { setLogoUrl(""); setLogoError(null); }}><IconX size={13} /></button>}
            </div>
            {logoError && <p className="text-xs text-danger-fg">{logoError}</p>}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleLogoFile} />
      </div>
      <div>
        <label className="label block mb-1">Descripción breve del negocio</label>
        <textarea className="input resize-none" rows={3} value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Ej. Red de clínicas dentales en LATAM enfocadas en ortodoncia..." />
      </div>
      <div className="flex justify-end pt-2">
        <button className="btn-primary flex items-center gap-2" onClick={save} disabled={saving || !name.trim() || !slug.trim()}>
          {saving ? <IconLoader2 size={15} className="animate-spin" /> : <IconArrowRight size={15} />}
          {saving ? "Guardando..." : "Siguiente — Paso 2"}
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Subir ICP ───────────────────────────────────────────────────────

function Step2({ client, onComplete }: { client: ClientData; onComplete: (c: ClientData) => void }) {
  const [fileContent, setFileContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [sections, setSections] = useState<Record<string, string>>({});
  const [parsed, setParsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      const text = (ev.target?.result as string) ?? "";
      setFileContent(text);
      setSections(parseICPText(text));
      setParsed(true);
    };
    reader.readAsText(file);
  }

  const missing = CRITICAL_SECTIONS.filter(k => !sections[k]?.trim());

  async function save() {
    if (!fileContent.trim()) return;
    setSaving(true); setError(null);
    const ctxRes = await fetch(`/api/clients/${client.id}/context`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_name: fileName || "icp.txt", file_type: "icp", content: fileContent }),
    });
    const ctxJ = await ctxRes.json();
    if (ctxJ.error) { setError(ctxJ.error); setSaving(false); return; }
    const pRes = await fetch(`/api/clients/${client.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboarding_step: Math.max(client.onboarding_step, 2) }),
    });
    const pJ = await pRes.json();
    if (pJ.error) { setError(pJ.error); setSaving(false); return; }
    onComplete(pJ.client);
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-danger-fg text-sm bg-danger-bg rounded-lg px-3 py-2">{error}</p>}
      <p className="text-sm text-ink-muted">
        Sube el archivo <strong>.txt</strong> generado en{" "}
        <a href="https://icp.bullseye-abm.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#62E0D8" }}>
          icp.bullseye-abm.com
        </a>
      </p>
      <label className="flex items-center gap-3 cursor-pointer border-2 border-dashed rounded-xl p-5 hover:bg-gray-50 transition-colors" style={{ borderColor: "#c8c3dc" }}>
        <IconUpload size={22} className="text-ink-muted shrink-0" />
        <div>
          <p className="text-sm font-medium text-ink">{fileName || "Seleccionar archivo ICP (.txt)"}</p>
          <p className="text-xs text-ink-subtle mt-0.5">Formato .txt exportado de icp.bullseye-abm.com</p>
        </div>
        <input type="file" accept=".txt,text/plain" className="hidden" onChange={handleFile} />
      </label>

      {parsed && (
        <>
          {missing.length > 0 && (
            <div className="flex gap-2 rounded-lg px-4 py-3" style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)" }}>
              <IconAlertTriangle size={16} className="text-yellow-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-700">Secciones críticas sin contenido:</p>
                <p className="text-xs text-yellow-600 mt-0.5">{missing.map(k => SECTION_LABELS[k]).join(", ")}</p>
                <p className="text-xs text-yellow-600 mt-0.5">Puedes continuar pero el scoring puede ser menos preciso.</p>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Secciones encontradas ({Object.values(sections).filter(v => v?.trim()).length}/7):</p>
            {Object.entries(SECTION_LABELS).map(([key, label]) => {
              const content = sections[key];
              return (
                <div key={key} className="rounded-lg p-3" style={{ background: "rgba(37,23,98,0.04)", border: "1px solid #e5e3f0" }}>
                  <div className="flex items-center gap-2 mb-1">
                    {content?.trim() ? <IconCheck size={13} style={{ color: "#62E0D8" }} /> : <IconX size={13} className="text-red-400" />}
                    <span className="text-xs font-semibold text-ink">{label}</span>
                    {CRITICAL_SECTIONS.includes(key) && !content?.trim() && <span className="text-xs text-yellow-600 font-medium">⚠ Crítica</span>}
                  </div>
                  {content?.trim()
                    ? <p className="text-xs text-ink-muted line-clamp-2 pl-5">{content}</p>
                    : <p className="text-xs text-ink-subtle pl-5">No encontrada</p>}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="flex justify-end pt-2">
        <button className="btn-primary flex items-center gap-2" onClick={save} disabled={saving || !parsed}>
          {saving ? <IconLoader2 size={15} className="animate-spin" /> : <IconArrowRight size={15} />}
          {saving ? "Guardando..." : "Guardar ICP y continuar"}
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: HubSpot ─────────────────────────────────────────────────────────

function Step3({ client, onComplete }: { client: ClientData; onComplete: (c: ClientData) => void }) {
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyMsg, setVerifyMsg] = useState("");
  const [owners, setOwners] = useState<HubSpotOwner[]>([]);
  const [saving, setSaving] = useState(false);

  async function verify() {
    setVerifyStatus("loading");
    try {
      const res = await fetch("/api/hubspot/owners");
      const j = await res.json();
      if (!res.ok || j.error) { setVerifyStatus("error"); setVerifyMsg(j.error ?? `Error ${res.status}`); return; }
      setOwners(j.owners ?? []);
      setVerifyStatus("ok");
      setVerifyMsg(`${(j.owners ?? []).length} usuarios encontrados en HubSpot.`);
    } catch { setVerifyStatus("error"); setVerifyMsg("Error de red."); }
  }

  async function next() {
    setSaving(true);
    const res = await fetch(`/api/clients/${client.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboarding_step: Math.max(client.onboarding_step, 3) }),
    });
    const j = await res.json();
    if (!j.error) onComplete(j.client);
    setSaving(false);
  }

  const sdrOwner = client.hubspot_owner_id ? owners.find(o => o.id === client.hubspot_owner_id) : null;

  return (
    <div className="space-y-6">
      <div className="rounded-xl p-5" style={{ background: "rgba(37,23,98,0.04)", border: "1px solid #e5e3f0" }}>
        <p className="text-sm text-ink-muted mb-4">
          HubSpot es una cuenta global compartida. Este paso verifica que el token funciona. No se crean pipelines ni propiedades (ya existen globalmente).
        </p>
        <button className="btn-secondary flex items-center gap-2" onClick={verify} disabled={verifyStatus === "loading"}>
          {verifyStatus === "loading" ? <IconLoader2 size={14} className="animate-spin" /> : <IconRefresh size={14} />}
          Verificar conexión HubSpot
        </button>
        {verifyStatus !== "idle" && (
          <div className={`mt-4 flex items-start gap-3 rounded-lg p-3 ${verifyStatus === "ok" ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
            <StatusIcon s={verifyStatus} />
            <div>
              <p className={`text-sm font-medium ${verifyStatus === "ok" ? "text-green-700" : "text-red-700"}`}>
                {verifyStatus === "ok" ? "HubSpot conectado ✓" : "Error de conexión"}
              </p>
              <p className={`text-xs mt-0.5 ${verifyStatus === "ok" ? "text-green-600" : "text-red-600"}`}>{verifyMsg}</p>
            </div>
          </div>
        )}
      </div>

      {client.hubspot_owner_id && (
        <div className="rounded-lg p-4" style={{ background: "rgba(98,224,216,0.08)", border: "1px solid rgba(98,224,216,0.3)" }}>
          <p className="text-xs text-ink-muted mb-1">SDR asignado (configurado en Paso 1)</p>
          <p className="text-sm font-semibold text-ink">
            {sdrOwner ? `${sdrOwner.firstName} ${sdrOwner.lastName} — ${sdrOwner.email}` : `ID: ${client.hubspot_owner_id}`}
          </p>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button className="btn-primary flex items-center gap-2" onClick={next} disabled={saving}>
          {saving ? <IconLoader2 size={15} className="animate-spin" /> : <IconArrowRight size={15} />}
          {saving ? "Guardando..." : "Continuar — Paso 4"}
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Clay ────────────────────────────────────────────────────────────

function Step4({ client, onComplete }: { client: ClientData; onComplete: (c: ClientData) => void }) {
  const [prompt, setPrompt] = useState(client.clay_scoring_prompt ?? "");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);

  const [companiesUrl, setCompaniesUrl] = useState(client.clay_companies_webhook_url ?? "");
  const [contactsUrl, setContactsUrl] = useState(client.clay_contacts_webhook_url ?? "");
  const [companiesStatus, setCompaniesStatus] = useState<VerifyStatus>(client.clay_companies_webhook_url ? "ok" : "idle");
  const [contactsStatus, setContactsStatus] = useState<VerifyStatus>(client.clay_contacts_webhook_url ? "ok" : "idle");
  const [companiesMsg, setCompaniesMsg] = useState(client.clay_companies_webhook_url ? "URL guardada previamente." : "");
  const [contactsMsg, setContactsMsg] = useState(client.clay_contacts_webhook_url ? "URL guardada previamente." : "");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function generatePrompt() {
    setPromptLoading(true); setPromptError(null);
    const res = await fetch(`/api/clients/${client.id}/clay-scoring-prompt`, { method: "POST" });
    const j = await res.json();
    if (j.error) { setPromptError(j.error); setPromptLoading(false); return; }
    setPrompt(j.prompt ?? "");
    setPromptLoading(false);
  }

  async function verifyWebhook(type: "companies" | "contacts") {
    const url = type === "companies" ? companiesUrl : contactsUrl;
    const setS = type === "companies" ? setCompaniesStatus : setContactsStatus;
    const setM = type === "companies" ? setCompaniesMsg : setContactsMsg;
    if (!url.trim()) { setM("Ingresa la URL primero."); setS("error"); return; }
    setS("loading");
    try {
      const res = await fetch(`/api/clients/${client.id}/verify-clay-webhook`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), type }),
      });
      const j = await res.json();
      if (!res.ok || j.error) { setS("error"); setM(j.error ?? "Error"); return; }
      setS("ok"); setM("Webhook verificado y guardado.");
    } catch { setS("error"); setM("Error de red."); }
  }

  async function next() {
    setSaving(true); setSaveError(null);
    const res = await fetch(`/api/clients/${client.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboarding_step: Math.max(client.onboarding_step, 4) }),
    });
    const j = await res.json();
    if (j.error) { setSaveError(j.error); setSaving(false); return; }
    onComplete(j.client);
  }

  return (
    <div className="space-y-8">

      {/* A — Instrucciones */}
      <div>
        <h3 className="text-sm font-semibold text-ink mb-4 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white" style={{ background: "#251762" }}>A</span>
          Instrucciones — Configurar Clay
        </h3>
        <div className="space-y-5 text-sm">
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5" style={{ background: "#62E0D8", color: "#251762" }}>1</span>
            <p className="text-ink">New Workbook → nombre: <strong>&quot;{client.name} — BullsEye&quot;</strong></p>
          </div>
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5" style={{ background: "#62E0D8", color: "#251762" }}>2</span>
            <div className="flex-1 space-y-3">
              <p className="text-ink font-medium">Tabla Companies — {client.name}</p>
              <p className="text-ink-muted"><strong>Columna 1:</strong> Webhook Source (Pull from Webhook) → copiar URL que aparece → pegarla en sección C de abajo → activar <em>Auto-run on new data</em></p>
              <p className="text-ink-muted"><strong>Columna 2:</strong> Find People (Clay AI Enrichment) → input: LinkedIn URL, máximo 8–10 contactos, todos OPCIONALES</p>
              <div>
                <p className="text-ink-muted mb-2"><strong>Columna 3:</strong> HTTP API → POST</p>
                <div className="space-y-2 pl-2">
                  <CopyBlock content={`${PROD_URL}/api/clay/raw-contacts`} label="URL" />
                  <CopyBlock content="x-webhook-secret: bullseye-clay-2026" label="Header" />
                  <CopyBlock content={COMPANIES_BODY} label="Body" />
                  <p className="text-xs text-ink-muted">Run condition: Find People terminó</p>
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5" style={{ background: "#62E0D8", color: "#251762" }}>3</span>
            <div className="flex-1 space-y-3">
              <p className="text-ink font-medium">Tabla Contacts — {client.name}</p>
              <p className="text-ink-muted"><strong>Columna 1:</strong> Webhook Source → copiar URL → pegarla en sección C de abajo</p>
              <p className="text-ink-muted"><strong>Columna 2:</strong> Lead Scoring AI → usar prompt de sección B → todos los inputs OPCIONALES</p>
              <div>
                <p className="text-ink-muted mb-2"><strong>Columna 3:</strong> HTTP API → POST</p>
                <div className="space-y-2 pl-2">
                  <CopyBlock content={`${PROD_URL}/api/clay/scored-contacts`} label="URL" />
                  <CopyBlock content="x-webhook-secret: bullseye-clay-2026" label="Header" />
                  <CopyBlock content={CONTACTS_BODY} label="Body" />
                  <p className="text-xs text-ink-muted">Run condition: Lead Scoring action != &quot;&quot;</p>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-lg px-3 py-2 text-xs font-medium" style={{ background: "rgba(251,191,36,0.1)", color: "#92400e" }}>
            ⚠ IMPORTANTE: NO crear columnas LinkedIn Icebreaker, Email Personalizer ni Add Lead to Campaign.
          </div>
        </div>
      </div>

      {/* B — Scoring prompt */}
      <div>
        <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white" style={{ background: "#251762" }}>B</span>
          Prompt de Lead Scoring
        </h3>
        <p className="text-xs text-ink-muted mb-3">Prompt personalizado para la columna &quot;Lead Scoring AI&quot; de Clay. Requiere tener el ICP guardado (Paso 2).</p>
        <button className="btn-secondary flex items-center gap-2 mb-3" onClick={generatePrompt} disabled={promptLoading}>
          {promptLoading ? <IconLoader2 size={14} className="animate-spin" /> : <IconWand size={14} />}
          {promptLoading ? "Generando..." : "Generar prompt con IA"}
        </button>
        {promptError && <p className="text-danger-fg text-xs mb-2">{promptError}</p>}
        <div className="relative">
          <textarea className="input resize-none font-mono text-xs" rows={10} value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="El prompt aparecerá aquí. Cópialo en la columna Lead Scoring AI de Clay." />
          {prompt && (
            <button
              className="absolute top-2 right-2 text-xs px-2 py-0.5 rounded font-medium flex items-center gap-1"
              style={{ background: promptCopied ? "#62E0D8" : "rgba(37,23,98,0.1)", color: "#251762" }}
              onClick={() => { navigator.clipboard.writeText(prompt); setPromptCopied(true); setTimeout(() => setPromptCopied(false), 2000); }}
            >
              <IconCopy size={10} />{promptCopied ? "✓ Copiado" : "Copiar"}
            </button>
          )}
        </div>
      </div>

      {/* C — Webhook URLs */}
      <div>
        <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white" style={{ background: "#251762" }}>C</span>
          URLs de Webhook de Clay
        </h3>
        <p className="text-xs text-ink-muted mb-4">
          En Clay: tabla → columna Webhook → panel derecho → copia la URL (empieza con <code>https://api.clay.com/v3/sources/webhook/...</code>)
        </p>
        <div className="space-y-4">
          {([
            { label: "Companies webhook URL", value: companiesUrl, setter: setCompaniesUrl, type: "companies" as const, status: companiesStatus, msg: companiesMsg },
            { label: "Contacts webhook URL",  value: contactsUrl,  setter: setContactsUrl,  type: "contacts"  as const, status: contactsStatus,  msg: contactsMsg  },
          ] as const).map(({ label, value, setter, type, status, msg }) => (
            <div key={type}>
              <label className="label block mb-1">{label}</label>
              <div className="flex gap-2">
                <input className="input flex-1 text-sm font-mono" placeholder="https://api.clay.com/v3/sources/webhook/..."
                  value={value} onChange={e => setter(e.target.value)} />
                <button className="btn-secondary px-3 shrink-0 flex items-center gap-1.5 text-sm"
                  onClick={() => verifyWebhook(type)} disabled={status === "loading"}>
                  {status === "loading" ? <IconLoader2 size={13} className="animate-spin" /> : <IconCheck size={13} />}
                  Verificar
                </button>
              </div>
              {msg && <p className={`text-xs mt-1 ${status === "ok" ? "text-green-600" : "text-red-500"}`}>{status === "ok" ? "✓ " : "✗ "}{msg}</p>}
            </div>
          ))}
        </div>
      </div>

      {saveError && <p className="text-danger-fg text-sm">{saveError}</p>}
      <div className="flex justify-end pt-2">
        <button className="btn-primary flex items-center gap-2" onClick={next} disabled={saving}>
          {saving ? <IconLoader2 size={15} className="animate-spin" /> : <IconArrowRight size={15} />}
          {saving ? "Guardando..." : "Continuar — Paso 5"}
        </button>
      </div>
    </div>
  );
}

// ─── Step 5: Lemlist ─────────────────────────────────────────────────────────

type CampaignTexts = {
  emailSubject: string; emailBody: string;
  emailFollowUp: string; emailFollowUp2: string; breakupEmail: string;
  linkedinIcebreaker: string; linkedinIcebreakerNoEmail: string;
};

function CopyTextarea({ label, step, value }: { label: string; step: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const rows = value.split("\n").length > 3 ? 5 : 3;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="label">{label}</label>
        <span className="text-xs text-ink-subtle italic">{step}</span>
      </div>
      <div className="relative">
        <textarea className="input resize-none text-sm" rows={rows} value={value} readOnly />
        <button className="absolute top-2 right-2 text-xs px-2 py-0.5 rounded font-medium flex items-center gap-1"
          style={{ background: copied ? "#62E0D8" : "rgba(37,23,98,0.1)", color: "#251762" }}
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          <IconCopy size={10} />{copied ? "✓" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

function Step5({ client, config, onComplete }: {
  client: ClientData; config: ConfigData | null;
  onComplete: (c: ClientData, cfg: ConfigData) => void;
}) {
  const [texts, setTexts] = useState<CampaignTexts | null>(null);
  const [textsLoading, setTextsLoading] = useState(false);
  const [textsError, setTextsError] = useState<string | null>(null);

  const [mainId, setMainId] = useState(config?.lemlist_campaign_id ?? "");
  const [stagingId, setStagingId] = useState(config?.lemlist_staging_campaign_id ?? "");
  const [mainStatus, setMainStatus] = useState<VerifyStatus>("idle");
  const [stagingStatus, setStagingStatus] = useState<VerifyStatus>("idle");
  const [mainMsg, setMainMsg] = useState("");
  const [stagingMsg, setStagingMsg] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function generateTexts() {
    setTextsLoading(true); setTextsError(null);
    const res = await fetch(`/api/clients/${client.id}/generate-campaign-texts`, { method: "POST" });
    const j = await res.json();
    if (j.error) { setTextsError(j.error); setTextsLoading(false); return; }
    setTexts(j.texts); setTextsLoading(false);
  }

  async function verifyCampaign(type: "main" | "staging") {
    const id = type === "main" ? mainId : stagingId;
    const setS = type === "main" ? setMainStatus : setStagingStatus;
    const setM = type === "main" ? setMainMsg : setStagingMsg;
    if (!id.trim()) { setM("Ingresa el ID primero."); setS("error"); return; }
    setS("loading");
    try {
      const res = await fetch(`/api/clients/${client.id}/verify-lemlist-campaign?campaign_id=${encodeURIComponent(id.trim())}`);
      const j = await res.json();
      if (!res.ok || j.error) { setS("error"); setM(j.error ?? "Error"); return; }
      setS("ok"); setM(`Campaña encontrada: "${j.name}"`);
    } catch { setS("error"); setM("Error de red."); }
  }

  async function next() {
    setSaving(true); setSaveError(null);
    const cfgRes = await fetch(`/api/clients/${client.id}/config`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lemlist_campaign_id: mainId.trim() || null, lemlist_staging_campaign_id: stagingId.trim() || null }),
    });
    const cfgJ = await cfgRes.json();
    if (cfgJ.error) { setSaveError(cfgJ.error); setSaving(false); return; }
    const pRes = await fetch(`/api/clients/${client.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboarding_step: Math.max(client.onboarding_step, 5) }),
    });
    const pJ = await pRes.json();
    if (pJ.error) { setSaveError(pJ.error); setSaving(false); return; }
    onComplete(pJ.client, cfgJ.config);
  }

  return (
    <div className="space-y-8">
      {/* A — Instrucciones */}
      <div>
        <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white" style={{ background: "#251762" }}>A</span>
          Instrucciones — Configurar Lemlist
        </h3>
        <div className="space-y-2">
          {[
            `Lemlist → Settings → Team → Add seat ($66/mes). Conectar email + LinkedIn del cliente. Activar warm-up si dominio nuevo (mínimo 2 semanas).`,
            `New Campaign → "BullsEye — ${client.name} Outreach v1"`,
            `New Campaign → "BullsEye — ${client.name} Staging" (sin pasos, vacía — campaña puente)`,
          ].map((text, i) => (
            <div key={i} className="flex gap-3 rounded-lg p-3 text-sm text-ink-muted" style={{ background: "rgba(37,23,98,0.04)" }}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white" style={{ background: "#62E0D8", color: "#251762" }}>{i + 1}</span>
              <p>{text}</p>
            </div>
          ))}
        </div>
        {/* Diagrama de flujo */}
        <div className="mt-4 rounded-xl overflow-hidden border" style={{ borderColor: "#e5e3f0" }}>
          <div className="px-4 py-2 text-xs font-semibold text-center text-white" style={{ background: "#251762" }}>
            CONDICIÓN INICIAL: ¿Tiene email? (Not verified / Deliverable / Risky)
          </div>
          <div className="grid grid-cols-2" style={{ borderTop: "1px solid #e5e3f0" }}>
            <div className="p-4 border-r" style={{ borderColor: "#e5e3f0" }}>
              <p className="text-xs font-bold mb-3" style={{ color: "#62E0D8" }}>✓ SÍ tiene email</p>
              {["2d → Email inicial", "2d → LinkedIn Invitation", "  ├ Acepta → 3d → LinkedIn Chat", "  └ No acepta → 3d → Email follow-up", "5d → Email follow-up 2", "5d → Breakup email"].map((s, i) => (
                <p key={i} className="text-xs text-ink-muted font-mono leading-6">{s}</p>
              ))}
            </div>
            <div className="p-4">
              <p className="text-xs font-bold mb-3 text-ink-muted">✗ NO tiene email</p>
              {["1d → LinkedIn Visit Profile", "2d → LinkedIn Invitation", "1d → LinkedIn Like último post", "3d → LinkedIn Chat [FIN]"].map((s, i) => (
                <p key={i} className="text-xs text-ink-muted font-mono leading-6">{s}</p>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* B — Textos */}
      <div>
        <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white" style={{ background: "#251762" }}>B</span>
          Textos de secuencia — generados con IA
        </h3>
        <button className="btn-secondary flex items-center gap-2 mb-4" onClick={generateTexts} disabled={textsLoading}>
          {textsLoading ? <IconLoader2 size={14} className="animate-spin" /> : <IconWand size={14} />}
          {textsLoading ? "Generando textos..." : "Generar textos de campaña"}
        </button>
        {textsError && <p className="text-danger-fg text-xs mb-3">{textsError}</p>}
        {texts && (
          <div className="space-y-4">
            <p className="text-xs font-semibold text-ink uppercase tracking-wide">Rama con email</p>
            <CopyTextarea label="Asunto email inicial" step="Email inicial" value={texts.emailSubject} />
            <CopyTextarea label="Cuerpo email inicial" step="Email inicial" value={texts.emailBody} />
            <CopyTextarea label="Email follow-up" step="Después de LinkedIn Invitation (no acepta)" value={texts.emailFollowUp} />
            <CopyTextarea label="Email follow-up 2" step="5 días después" value={texts.emailFollowUp2} />
            <CopyTextarea label="Breakup email" step="Último email — rama con email" value={texts.breakupEmail} />
            <CopyTextarea label="LinkedIn Chat (acepta invite)" step="Cuando acepta el invite" value={texts.linkedinIcebreaker} />
            <p className="text-xs font-semibold text-ink uppercase tracking-wide pt-2">Rama sin email</p>
            <CopyTextarea label="LinkedIn Chat (sin email)" step="Último paso — rama sin email" value={texts.linkedinIcebreakerNoEmail} />
          </div>
        )}
      </div>

      {/* C — IDs de campaña */}
      <div>
        <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white" style={{ background: "#251762" }}>C</span>
          IDs de campaña
        </h3>
        <p className="text-xs text-ink-muted mb-4">Encuéntralos en la URL de cada campaña: <code>lemlist.com/app/campaigns/cam_XXXXXXX/...</code></p>
        <div className="space-y-4">
          {([
            { label: "Campaign ID principal", hint: `BullsEye — ${client.name} Outreach v1`, placeholder: "cam_XXXXXXXXXXXXXXX", value: mainId, setter: setMainId, type: "main" as const, status: mainStatus, msg: mainMsg },
            { label: "Staging Campaign ID",   hint: `BullsEye — ${client.name} Staging`,     placeholder: "cam_YYYYYYYYYYYYYYY", value: stagingId, setter: setStagingId, type: "staging" as const, status: stagingStatus, msg: stagingMsg },
          ] as const).map(({ label, hint, placeholder, value, setter, type, status, msg }) => (
            <div key={type}>
              <label className="label block mb-1">{label}</label>
              <p className="text-xs text-ink-subtle mb-1">{hint}</p>
              <div className="flex gap-2">
                <input className="input flex-1 font-mono text-sm" placeholder={placeholder} value={value} onChange={e => setter(e.target.value)} />
                <button className="btn-secondary px-3 shrink-0 flex items-center gap-1.5 text-sm" onClick={() => verifyCampaign(type)} disabled={status === "loading"}>
                  {status === "loading" ? <IconLoader2 size={13} className="animate-spin" /> : <IconCheck size={13} />}
                  Verificar
                </button>
              </div>
              {msg && <p className={`text-xs mt-1 ${status === "ok" ? "text-green-600" : "text-red-500"}`}>{status === "ok" ? "✓ " : "✗ "}{msg}</p>}
            </div>
          ))}
        </div>
      </div>

      {saveError && <p className="text-danger-fg text-sm">{saveError}</p>}
      <div className="flex justify-end pt-2">
        <button className="btn-primary flex items-center gap-2" onClick={next} disabled={saving}>
          {saving ? <IconLoader2 size={15} className="animate-spin" /> : <IconArrowRight size={15} />}
          {saving ? "Guardando..." : "Continuar — Paso 6"}
        </button>
      </div>
    </div>
  );
}

// ─── Step 6: Verificación final y activación ─────────────────────────────────

function CheckItem({ label, status, detail }: { label: string; status: VerifyStatus; detail?: string }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b last:border-0" style={{ borderColor: "#f0eef8" }}>
      <StatusIcon s={status} />
      <div className="flex-1">
        <p className="text-sm text-ink">{label}</p>
        {detail && <p className={`text-xs mt-0.5 ${status === "ok" ? "text-green-600" : status === "error" ? "text-red-500" : "text-ink-subtle"}`}>{detail}</p>}
      </div>
    </div>
  );
}

function Step6({ client, config }: { client: ClientData; config: ConfigData | null }) {
  const router = useRouter();
  const { setCurrentClient } = useClient();

  const [checks, setChecks] = useState<Record<string, VerifyStatus>>({
    basicData: "idle", icp: "idle", hubspot: "idle",
    clayCompanies: "idle", clayContacts: "idle",
    lemlistMain: "idle", lemlistStaging: "idle",
  });
  const [details, setDetails] = useState<Record<string, string>>({});
  const [activating, setActivating] = useState(false);
  const [done, setDone] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function setCheck(key: string, s: VerifyStatus, d?: string) {
    setChecks(prev => ({ ...prev, [key]: s }));
    if (d !== undefined) setDetails(prev => ({ ...prev, [key]: d }));
  }

  async function runChecks() {
    setChecks({ basicData: "loading", icp: "loading", hubspot: "loading", clayCompanies: "loading", clayContacts: "loading", lemlistMain: "loading", lemlistStaging: "loading" });

    setCheck("basicData", client.name && client.slug ? "ok" : "error", client.name && client.slug ? "Nombre y slug configurados" : "Faltan datos básicos");

    try {
      const r = await fetch(`/api/clients/${client.id}/context`);
      const j = await r.json();
      const hasIcp = (j.items ?? []).some((i: { file_type: string }) => i.file_type === "icp");
      setCheck("icp", hasIcp ? "ok" : "error", hasIcp ? "ICP cargado" : "ICP no encontrado — completa el Paso 2");
    } catch { setCheck("icp", "error", "Error al verificar ICP"); }

    try {
      const r = await fetch("/api/hubspot/owners");
      setCheck("hubspot", r.ok ? "ok" : "error", r.ok ? "HubSpot responde correctamente" : `HubSpot respondió ${r.status}`);
    } catch { setCheck("hubspot", "error", "Error de red"); }

    setCheck("clayCompanies", client.clay_companies_webhook_url ? "ok" : "error",
      client.clay_companies_webhook_url ? "URL verificada en Paso 4" : "URL no configurada — completa el Paso 4");
    setCheck("clayContacts", client.clay_contacts_webhook_url ? "ok" : "error",
      client.clay_contacts_webhook_url ? "URL verificada en Paso 4" : "URL no configurada — completa el Paso 4");

    for (const [key, id] of [["lemlistMain", config?.lemlist_campaign_id], ["lemlistStaging", config?.lemlist_staging_campaign_id]] as [string, string | null | undefined][]) {
      if (id) {
        try {
          const r = await fetch(`/api/clients/${client.id}/verify-lemlist-campaign?campaign_id=${encodeURIComponent(id)}`);
          const j = await r.json();
          setCheck(key, r.ok ? "ok" : "error", r.ok ? `"${j.name}"` : (j.error ?? "Error"));
        } catch { setCheck(key, "error", "Error de red"); }
      } else {
        setCheck(key, "error", "ID no configurado — completa el Paso 5");
      }
    }
  }

  useEffect(() => { runChecks(); }, []);

  async function activate() {
    setActivating(true);
    const res = await fetch(`/api/clients/${client.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active", onboarding_step: 6, onboarding_completed_at: new Date().toISOString(), is_active: true }),
    });
    const j = await res.json();
    if (j.error) { setActivating(false); return; }
    setCurrentClient({ id: j.client.id, name: j.client.name, slug: j.client.slug, logo_url: j.client.logo_url });
    setDone(true);
    setToast(`¡Cliente ${j.client.name} configurado y listo para prospectar!`);
    setTimeout(() => router.push("/empresas"), 2500);
  }

  const allOk = Object.values(checks).every(s => s === "ok");
  const anyLoading = Object.values(checks).some(s => s === "loading");

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3 text-white font-medium shadow-xl"
          style={{ background: "#251762", border: "2px solid #62E0D8" }}>
          {toast}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-ink">Verificación de todas las conexiones</p>
          <button className="btn-secondary text-xs flex items-center gap-1.5 py-1.5" onClick={runChecks} disabled={anyLoading}>
            <IconRefresh size={12} /> Re-verificar todo
          </button>
        </div>
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#e5e3f0" }}>
          <CheckItem label="Datos básicos completados"           status={checks.basicData}      detail={details.basicData} />
          <CheckItem label="ICP cargado con secciones críticas"  status={checks.icp}            detail={details.icp} />
          <CheckItem label="HubSpot verificado"                  status={checks.hubspot}        detail={details.hubspot} />
          <CheckItem label="Clay Companies webhook verificado"   status={checks.clayCompanies}  detail={details.clayCompanies} />
          <CheckItem label="Clay Contacts webhook verificado"    status={checks.clayContacts}   detail={details.clayContacts} />
          <CheckItem label="Lemlist campaña principal verificada" status={checks.lemlistMain}   detail={details.lemlistMain} />
          <CheckItem label="Lemlist campaña staging verificada"  status={checks.lemlistStaging} detail={details.lemlistStaging} />
        </div>
      </div>

      {!allOk && !anyLoading && (
        <div className="flex gap-2 rounded-lg px-4 py-3" style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)" }}>
          <IconAlertTriangle size={16} className="text-yellow-500 shrink-0 mt-0.5" />
          <p className="text-sm text-yellow-700">Hay verificaciones pendientes. Puedes activar de todas formas, pero algunas integraciones pueden no funcionar.</p>
        </div>
      )}

      <div className="flex justify-center pt-2">
        <button className="btn-primary flex items-center gap-3 px-8 py-3 text-base font-semibold"
          onClick={activate} disabled={activating || done || anyLoading}>
          {activating ? <IconLoader2 size={18} className="animate-spin" /> : done ? <IconCheck size={18} /> : <IconRocket size={18} />}
          {activating ? "Activando..." : done ? "¡Activado! Redirigiendo..." : "Activar cliente"}
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OnboardingPage({ params }: { params: { id: string } }) {
  const [client, setClient] = useState<ClientData | null>(null);
  const [config, setConfig]  = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(1);

  useEffect(() => {
    async function load() {
      try {
        const [cR, cfgR] = await Promise.all([
          fetch(`/api/clients/${params.id}`),
          fetch(`/api/clients/${params.id}/config`),
        ]);
        const cJ   = await cR.json();
        const cfgJ = await cfgR.json();
        if (cJ.error) { setError(cJ.error); setLoading(false); return; }
        setClient(cJ.client);
        setConfig(cfgJ.config ?? null);
        const nextStep = Math.min(Math.max((cJ.client.onboarding_step ?? 0) + 1, 1), 6);
        setActiveStep(nextStep);
      } catch { setError("Error cargando datos del cliente"); }
      finally   { setLoading(false); }
    }
    load();
  }, [params.id]);

  if (loading) return (
    <div className="max-w-3xl">
      <div className="card flex items-center gap-3 text-ink-muted">
        <IconLoader2 size={18} className="animate-spin" /> Cargando wizard de onboarding...
      </div>
    </div>
  );

  if (error || !client) return (
    <div className="max-w-3xl">
      <div className="card text-danger-fg bg-danger-bg">{error ?? "Cliente no encontrado"}</div>
      <Link href="/clientes" className="btn-secondary mt-4 inline-flex items-center gap-2">
        <IconArrowLeft size={15} /> Volver a Clientes
      </Link>
    </div>
  );

  function handleComplete(updated: ClientData, updatedConfig?: ConfigData) {
    setClient(updated);
    if (updatedConfig) setConfig(updatedConfig);
    setActiveStep(prev => Math.min(prev + 1, 6));
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/clientes" className="btn-secondary py-1.5 px-2"><IconArrowLeft size={16} /></Link>
        <div>
          <h1 className="text-xl font-bold text-ink flex items-center gap-2">
            {client.logo_url && <img src={client.logo_url} alt="" className="w-6 h-6 rounded object-cover inline-block" />}
            {client.name}
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Wizard de onboarding — Paso {activeStep}: {STEP_LABELS[activeStep - 1]}
          </p>
        </div>
      </div>

      <WizardStepper current={activeStep} completed={client.onboarding_step}
        onStepClick={n => { if (n <= client.onboarding_step + 1) setActiveStep(n); }} />

      <div className="card">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: "#251762" }}>{activeStep}</div>
          <h2 className="text-lg font-semibold text-ink">Paso {activeStep} — {STEP_LABELS[activeStep - 1]}</h2>
        </div>

        {activeStep === 1 && <Step1 client={client} onComplete={c => handleComplete(c)} />}
        {activeStep === 2 && <Step2 client={client} onComplete={c => handleComplete(c)} />}
        {activeStep === 3 && <Step3 client={client} onComplete={c => handleComplete(c)} />}
        {activeStep === 4 && <Step4 client={client} onComplete={c => handleComplete(c)} />}
        {activeStep === 5 && <Step5 client={client} config={config} onComplete={(c, cfg) => handleComplete(c, cfg)} />}
        {activeStep === 6 && <Step6 client={client} config={config} />}
      </div>
    </div>
  );
}
