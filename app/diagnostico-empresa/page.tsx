"use client";

import { useState } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconLoader2,
  IconAlertCircle,
  IconCheck,
  IconX,
  IconQuestionMark,
  IconBuildingFactory2,
  IconBrandLinkedin,
  IconWorld,
  IconMapPin,
  IconUsers,
  IconSend,
  IconExternalLink,
  IconSparkles,
} from "@tabler/icons-react";

type FitVerdict = "yes" | "no" | "maybe";

type DiagnosticResult = {
  fit_verdict: FitVerdict;
  fit_score: number | null;
  fit_reason: string | null;
  fit_signals: string | null;
  company_name: string;
  research_summary: string | null;
  company_type: string | null;
  company_size: number | null;
  company_country: string | null;
  company_city: string | null;
  _raw: {
    linkedin_url: string | null;
    website: string | null;
    perplexity_content: string;
  };
};

const VERDICT: Record<FitVerdict, { label: string; desc: string; icon: React.ReactNode; bg: string; text: string; border: string }> = {
  yes: {
    label: "Es fit",
    desc: "La empresa cumple con el ICP del cliente",
    icon: <IconCheck size={22} strokeWidth={2.5} />,
    bg: "bg-success-bg",
    text: "text-success-fg",
    border: "border-success-bg",
  },
  no: {
    label: "No es fit",
    desc: "La empresa no cumple con el ICP del cliente",
    icon: <IconX size={22} strokeWidth={2.5} />,
    bg: "bg-danger-bg",
    text: "text-danger-fg",
    border: "border-danger-bg",
  },
  maybe: {
    label: "Potencial fit",
    desc: "Requiere validación adicional",
    icon: <IconQuestionMark size={22} strokeWidth={2.5} />,
    bg: "bg-warning-bg",
    text: "text-warning-fg",
    border: "border-warning-bg",
  },
};

export default function DiagnosticoEmpresaPage() {
  const { currentClient } = useClient();

  const [name, setName]             = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [website, setWebsite]       = useState("");

  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [result, setResult]     = useState<DiagnosticResult | null>(null);

  const [adding, setAdding]         = useState(false);
  const [addedId, setAddedId]       = useState<string | null>(null);
  const [alreadyExists, setAlreadyExists] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !currentClient) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setAddedId(null);
    setAlreadyExists(false);

    try {
      const res = await fetch("/api/companies/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:        name.trim(),
          linkedin_url: linkedinUrl.trim() || undefined,
          website:     website.trim()     || undefined,
          client_id:   currentClient.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? `Error ${res.status}`);
      else         setResult(json);
    } catch {
      setError("Error de red al contactar el servidor");
    }
    setLoading(false);
  }

  async function addToPipeline() {
    if (!result || !currentClient) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/companies/add-from-diagnostic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id:       currentClient.id,
          company_name:    result.company_name,
          fit_score:       result.fit_score,
          fit_signals:     result.fit_signals,
          fit_reason:      result.fit_reason,
          research_summary: result.research_summary,
          company_type:    result.company_type,
          company_size:    result.company_size,
          company_country: result.company_country,
          company_city:    result.company_city,
          linkedin_url:    result._raw.linkedin_url,
          website:         result._raw.website,
        }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Error al agregar");
      else { setAddedId(json.company_id); setAlreadyExists(json.already_exists ?? false); }
    } catch {
      setError("Error de red al agregar");
    }
    setAdding(false);
  }

  const v = result ? VERDICT[result.fit_verdict] : null;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <header>
        <div className="label">Análisis</div>
        <h1 className="text-2xl font-semibold tracking-tight">Diagnóstico de Empresa</h1>
        <p className="text-sm text-ink-muted mt-1">
          Ingresa una empresa y Claude evaluará si es fit para{" "}
          <span className="font-medium text-ink">{currentClient?.name ?? "el cliente seleccionado"}</span>{" "}
          basándose en su ICP.
        </p>
      </header>

      {!currentClient && (
        <div className="card flex items-center gap-3 border border-warning-bg bg-warning-bg/40 text-warning-fg text-sm">
          <IconAlertCircle size={16} className="shrink-0" />
          Selecciona un cliente en el sidebar para diagnosticar empresas contra su ICP.
        </div>
      )}

      {/* Formulario */}
      <form onSubmit={handleSubmit} className="card space-y-4">
        <div>
          <div className="label mb-1">Nombre de empresa <span className="text-danger-fg">*</span></div>
          <input
            autoFocus
            required
            className="input"
            placeholder="Ej: ComunidadFeliz"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="label mb-1">LinkedIn URL</div>
            <input
              className="input"
              placeholder="https://linkedin.com/company/..."
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
            />
          </div>
          <div>
            <div className="label mb-1">Sitio web</div>
            <input
              className="input"
              placeholder="https://..."
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading || !name.trim() || !currentClient}
            className="btn-primary"
          >
            {loading
              ? <><IconLoader2 size={15} className="animate-spin" /> Analizando…</>
              : <><IconSparkles size={15} /> Analizar con IA</>}
          </button>
          {loading && <span className="text-sm text-ink-muted">Esto puede tardar 20–30 s…</span>}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-danger-fg bg-danger-bg rounded-lg px-3 py-2">
            <IconAlertCircle size={15} className="shrink-0" /> {error}
          </div>
        )}
      </form>

      {/* Resultado */}
      {result && v && (
        <div className="space-y-4">

          {/* Veredicto principal */}
          <div className={`card border-2 ${v.border}`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-full ${v.bg} ${v.text}`}>{v.icon}</div>
                <div>
                  <div className={`text-xl font-bold ${v.text}`}>{v.label}</div>
                  <div className="text-sm text-ink-muted">{v.desc}</div>
                </div>
              </div>
              {result.fit_score !== null && (
                <div className="text-right shrink-0">
                  <div className={`text-3xl font-bold ${v.text}`}>
                    {result.fit_score}
                    <span className="text-lg font-normal text-ink-muted">/10</span>
                  </div>
                  <div className="text-xs text-ink-muted">Fit score</div>
                </div>
              )}
            </div>

            {/* Razón del veredicto */}
            {result.fit_reason && (
              <p className="mt-4 text-sm text-ink/90 leading-relaxed border-t border-[#F1EEF7] pt-4">
                {result.fit_reason}
              </p>
            )}

            {/* Meta de la empresa */}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-muted">
              {(result.company_city || result.company_country) && (
                <span className="flex items-center gap-1">
                  <IconMapPin size={12} />
                  {[result.company_city, result.company_country].filter(Boolean).join(", ")}
                </span>
              )}
              {result.company_size && (
                <span className="flex items-center gap-1">
                  <IconUsers size={12} />
                  {result.company_size.toLocaleString()} empleados
                </span>
              )}
              {result.company_type && (
                <span className="flex items-center gap-1">
                  <IconBuildingFactory2 size={12} />
                  {result.company_type}
                </span>
              )}
              {result._raw.linkedin_url && (
                <a href={result._raw.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-brand">
                  <IconBrandLinkedin size={12} /> LinkedIn
                </a>
              )}
              {result._raw.website && (
                <a href={result._raw.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-brand">
                  <IconWorld size={12} /> Web
                </a>
              )}
            </div>

            {/* Señales de fit */}
            {result.fit_signals && (
              <div className="mt-4 pt-4 border-t border-[#F1EEF7]">
                <div className="label mb-2">Señales de fit</div>
                <div className="flex flex-wrap gap-2">
                  {result.fit_signals.split(" · ").map((s, i) => (
                    <span key={i} className="badge bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]">
                      {s.trim()}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Resumen de investigación */}
          {result.research_summary && (
            <div className="card">
              <div className="label mb-2">Resumen de investigación</div>
              <p className="text-sm text-ink/90 leading-relaxed">{result.research_summary}</p>
            </div>
          )}

          {/* Agregar al pipeline */}
          <div className="card">
            {addedId ? (
              <div className="flex items-center gap-3 flex-wrap">
                {alreadyExists ? (
                  <>
                    <IconAlertCircle size={18} className="text-warning-fg shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium">Ya existe en pipeline</div>
                      <div className="text-sm text-ink-muted">Esta empresa ya estaba en la lista del cliente.</div>
                    </div>
                  </>
                ) : (
                  <>
                    <IconCheck size={18} className="text-success-fg shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-success-fg">¡Empresa agregada al pipeline!</div>
                      <div className="text-sm text-ink-muted">Aparece en Empresas como "Pendiente" lista para aprobar.</div>
                    </div>
                  </>
                )}
                <a href="/empresas" className="btn-secondary ml-auto shrink-0 text-sm flex items-center gap-1.5">
                  Ver empresas <IconExternalLink size={13} />
                </a>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="font-medium">Agregar al pipeline de aprobación</div>
                  <div className="text-sm text-ink-muted mt-0.5">
                    Quedará como "Pendiente" en Empresas para revisión y aprobación.
                  </div>
                </div>
                <button onClick={addToPipeline} disabled={adding} className="btn-primary shrink-0">
                  {adding
                    ? <><IconLoader2 size={14} className="animate-spin" /> Agregando…</>
                    : <><IconSend size={14} /> Agregar a pipeline</>}
                </button>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
