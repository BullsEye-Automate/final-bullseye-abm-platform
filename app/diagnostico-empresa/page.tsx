"use client";

import { useRef, useState } from "react";
import {
  IconLoader2,
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight
} from "@tabler/icons-react";

// Tipos del resultado del diagnóstico
type KeywordMatch = {
  keyword: string;
  hits: number;
  snippets: string[];
};

type Citation = {
  title: string;
  url?: string;
  names_company: boolean;
};

type DiagnosticResult = {
  evidence_type: "specific" | "generic" | "none";
  named_citations: number;
  total_citations: number;
  keyword_matches: KeywordMatch[];
  extracted: {
    cad_software: string | null;
    scanner_technology: string | null;
    fit_signals: string | null;
    research_summary: string | null;
  };
  citations: Citation[];
  perplexity: {
    content: string;
    duration_ms: number;
  };
  claude: {
    raw_response: string;
    model_used: string;
    duration_ms: number;
  };
};

// Colores para hits de keywords
function hitsColor(hits: number): string {
  if (hits === 0) return "bg-danger-bg text-danger-fg";
  if (hits <= 2) return "bg-warning-bg text-warning-fg";
  return "bg-success-bg text-success-fg";
}

// Badge de evidencia
function EvidenceBadge({ type }: { type: "specific" | "generic" | "none" }) {
  const map = {
    specific: "bg-success-bg text-success-fg",
    generic: "bg-warning-bg text-warning-fg",
    none: "bg-danger-bg text-danger-fg"
  } as const;
  const label = { specific: "Específica", generic: "Genérica", none: "Sin evidencia" };
  return <span className={`badge ${map[type]}`}>{label[type]}</span>;
}

// Sección expandible de keywords
function KeywordSection({ matches }: { matches: KeywordMatch[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (matches.length === 0) return null;
  return (
    <div className="space-y-2">
      {matches.map((m, i) => (
        <div key={i} className="rounded-lg border border-[#E5E2F0] overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-[#F4F2FB] transition text-left"
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
          >
            <div className="flex items-center gap-3">
              <span className={`badge text-xs ${hitsColor(m.hits)}`}>{m.hits} hits</span>
              <span className="font-medium text-ink">{m.keyword}</span>
            </div>
            {openIdx === i ? (
              <IconChevronDown size={14} className="text-ink-muted shrink-0" />
            ) : (
              <IconChevronRight size={14} className="text-ink-muted shrink-0" />
            )}
          </button>
          {openIdx === i && m.snippets.length > 0 && (
            <div className="px-4 py-3 bg-[#F9F8FD] border-t border-[#E5E2F0] space-y-2">
              {m.snippets.map((s, j) => (
                <p key={j} className="text-xs text-ink/80 leading-relaxed">{s}</p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function DiagnosticoEmpresaPage() {
  // Campos del formulario
  const [name, setName]               = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [website, setWebsite]         = useState("");
  const [city, setCity]               = useState("");
  const [country, setCountry]         = useState("");
  const [extraKeywords, setExtraKeywords] = useState("");

  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [result, setResult]     = useState<DiagnosticResult | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const extra_keywords = extraKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    try {
      const res = await fetch("/api/companies/research-diagnostic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          hints: {
            linkedin_url: linkedinUrl.trim() || undefined,
            website: website.trim() || undefined,
            city: city.trim() || undefined,
            country: country.trim() || undefined
          },
          extra_keywords: extra_keywords.length > 0 ? extra_keywords : undefined
        })
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Error ${res.status}`);
      } else {
        setResult(json);
      }
    } catch {
      setError("Error de red al contactar el servidor");
    }
    setLoading(false);
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <header>
        <div className="label">Herramientas</div>
        <h1 className="text-2xl font-semibold tracking-tight">Diagnóstico de Empresa</h1>
        <div className="text-sm text-ink-muted mt-1">
          Investiga una empresa puntual con los prompts de producción. NO graba nada en la base.
        </div>
      </header>

      {/* Formulario */}
      <form onSubmit={handleSubmit} className="card space-y-4">
        <div>
          <label className="block">
            <div className="label mb-1">
              Nombre de empresa <span className="text-danger-fg">*</span>
            </div>
            <input
              ref={nameRef}
              autoFocus
              required
              className="input"
              placeholder="Ej: Dental Excellence Lab"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <div className="label mb-1">LinkedIn URL</div>
            <input
              className="input"
              placeholder="https://linkedin.com/company/..."
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
            />
          </label>
          <label className="block">
            <div className="label mb-1">Sitio web</div>
            <input
              className="input"
              placeholder="https://..."
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
          <label className="block">
            <div className="label mb-1">Ciudad</div>
            <input
              className="input"
              placeholder="Ej: Buenos Aires"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </label>
          <label className="block">
            <div className="label mb-1">País</div>
            <input
              className="input"
              placeholder="Ej: Argentina"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </label>
        </div>

        <label className="block">
          <div className="label mb-1">Keywords adicionales</div>
          <input
            className="input"
            placeholder="separadas por coma — ej: hiring, exocad, dentrix"
            value={extraKeywords}
            onChange={(e) => setExtraKeywords(e.target.value)}
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="btn-primary"
          >
            {loading && <IconLoader2 size={15} className="animate-spin" />}
            {loading ? "Investigando…" : "Investigar y diagnosticar"}
          </button>
          {loading && (
            <span className="text-sm text-ink-muted">
              Esto puede tardar 15–30 segundos…
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-danger-fg bg-danger-bg rounded-lg px-3 py-2">
            <IconAlertCircle size={15} className="shrink-0" />
            {error}
          </div>
        )}
      </form>

      {/* Resultados */}
      {result && (
        <div className="space-y-4">
          {/* Resumen superior */}
          <div className="card flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="label">Evidencia:</span>
              <EvidenceBadge type={result.evidence_type} />
              <span className="text-ink-muted">
                · {result.named_citations} de {result.total_citations} citas nombran la empresa
              </span>
            </div>
            <div className="text-ink-muted text-xs flex flex-wrap gap-x-3 gap-y-1">
              <span>Modelo: <strong className="text-ink">{result.claude?.model_used}</strong></span>
              <span>Perplexity: <strong className="text-ink">{result.perplexity?.duration_ms}ms</strong></span>
              <span>Claude: <strong className="text-ink">{result.claude?.duration_ms}ms</strong></span>
            </div>
          </div>

          {/* Keyword matches */}
          {result.keyword_matches && result.keyword_matches.length > 0 && (
            <div className="card space-y-3">
              <div className="label">Keyword Matches</div>
              <KeywordSection matches={result.keyword_matches} />
            </div>
          )}

          {/* Claude extrajo */}
          <div className="card space-y-3">
            <div className="label">Claude extrajo</div>
            <dl className="space-y-2 text-sm">
              {(
                [
                  ["cad_software", "cad_software"],
                  ["scanner_technology", "scanner_technology"],
                  ["fit_signals", "fit_signals"],
                  ["research_summary", "research_summary"]
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="grid grid-cols-[160px_1fr] gap-2">
                  <dt className="text-ink-muted font-mono text-xs pt-0.5">{label}:</dt>
                  <dd className="text-ink/90">
                    {result.extracted[key] ?? (
                      <span className="text-ink-muted font-mono">null</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Citas */}
          {result.citations && result.citations.length > 0 && (
            <div className="card space-y-3">
              <div className="label">
                Citas ({result.total_citations} — {result.named_citations} nombran la empresa)
              </div>
              <ul className="space-y-1.5 text-sm">
                {result.citations.map((c, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 shrink-0 font-semibold text-xs ${
                        c.names_company ? "text-success-fg" : "text-ink-muted"
                      }`}
                    >
                      {c.names_company ? "✓" : "✗"}
                    </span>
                    <div className="min-w-0">
                      {c.url ? (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-brand truncate block"
                        >
                          {c.title}
                        </a>
                      ) : (
                        <span className="text-ink/80">{c.title}</span>
                      )}
                      {!c.names_company && (
                        <span className="text-ink-muted text-xs ml-1">(no nombra)</span>
                      )}
                      {c.names_company && (
                        <span className="text-success-fg text-xs ml-1">(nombra)</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Contenido completo Perplexity */}
          <div className="card">
            <details>
              <summary className="cursor-pointer text-sm font-medium text-ink hover:text-brand flex items-center gap-2">
                <IconChevronRight size={14} className="text-ink-muted" />
                Contenido completo Perplexity
              </summary>
              <pre className="mt-3 text-xs text-ink/80 whitespace-pre-wrap bg-[#F4F2FB] rounded-lg p-4 overflow-auto max-h-96">
                {result.perplexity?.content}
              </pre>
            </details>
          </div>

          {/* Respuesta completa Claude */}
          <div className="card">
            <details>
              <summary className="cursor-pointer text-sm font-medium text-ink hover:text-brand flex items-center gap-2">
                <IconChevronRight size={14} className="text-ink-muted" />
                Respuesta completa Claude
              </summary>
              <pre className="mt-3 text-xs text-ink/80 whitespace-pre-wrap bg-[#F4F2FB] rounded-lg p-4 overflow-auto max-h-96">
                {result.claude?.raw_response}
              </pre>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
