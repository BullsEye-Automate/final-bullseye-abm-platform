"use client";

// Diagnóstico: ¿de dónde salió esta señal sobre esta empresa?
//
// Re-corre el research one-shot (mismo Perplexity + Claude que prod) sobre una
// empresa puntual y devuelve TODO crudo: contenido completo de Perplexity,
// respuesta completa de Claude, citas, y matches de palabras clave dentro del
// texto de Perplexity. NO inserta nada en la DB.
//
// Accesible vía URL directa: /diagnostico-empresa (no está en el sidebar).

import { useState } from "react";

type Citation = { title: string; url: string };
type Match = { keyword: string; count: number; snippets: string[] };

type DiagnosticResult = {
  hints: {
    name: string;
    linkedin_url: string | null;
    website: string | null;
    city: string | null;
    country: string | null;
  };
  perplexity: {
    content_chars: number;
    content_full: string;
    citations: Citation[];
  };
  claude: {
    model_used: string;
    response_chars: number;
    response_full: string;
    error: string | null;
  };
  matches_in_perplexity: Match[];
};

export default function DiagnosticoEmpresaPage() {
  const [name, setName] = useState("Elite Dental Lab");
  const [linkedin, setLinkedin] = useState("");
  const [website, setWebsite] = useState("");
  const [city, setCity] = useState("Salt Lake City");
  const [country, setCountry] = useState("US");
  const [extraKeywords, setExtraKeywords] = useState("CAM operator, contratando CAM");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const keywords = extraKeywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      const res = await fetch("/api/companies/research-diagnostic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          linkedin_url: linkedin.trim() || null,
          website: website.trim() || null,
          city: city.trim() || null,
          country: country.trim() || null,
          keywords
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas p-6 md:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-ink">Diagnóstico de research por empresa</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Re-corre Perplexity + Claude sobre una empresa puntual y muestra todo el
            contenido crudo. No inserta nada en la base. Sirve para auditar de dónde
            salió una señal específica en fit_signals.
          </p>
        </header>

        <section className="card space-y-3 p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block text-sm">
              <span className="text-ink-muted">Nombre de la empresa</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                placeholder="Elite Dental Lab"
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-muted">LinkedIn URL (opcional)</span>
              <input
                value={linkedin}
                onChange={(e) => setLinkedin(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                placeholder="https://www.linkedin.com/company/..."
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-muted">Sitio web (opcional)</span>
              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                placeholder="https://..."
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-muted">Ciudad (opcional)</span>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-muted">País ISO 2 letras (opcional)</span>
              <input
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                placeholder="US"
              />
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="text-ink-muted">
                Palabras clave extra para buscar en el texto de Perplexity (separadas por coma)
              </span>
              <input
                value={extraKeywords}
                onChange={(e) => setExtraKeywords(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                placeholder="CAM operator, contratando, hiring"
              />
              <span className="mt-1 block text-xs text-ink-muted">
                Además de éstas, el endpoint ya busca por defecto: nombre de la empresa,
                hiring, contratando, exocad, inLab, 3Shape, Evident, externaliza, etc.
              </span>
            </label>
          </div>
          <button
            onClick={run}
            disabled={loading || !name.trim()}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Investigando..." : "Investigar"}
          </button>
          {error && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
        </section>

        {result && (
          <>
            <section className="card space-y-3 p-5">
              <h2 className="text-lg font-semibold text-ink">
                Matches de palabras clave en el texto crudo de Perplexity
              </h2>
              <p className="text-sm text-ink-muted">
                Si "CAM operator" o "contratando" tiene 0 hits, o sus snippets no
                mencionan el nombre de la empresa, la señal probablemente fue
                alucinada por Claude (no estaba en la evidencia).
              </p>
              <ul className="space-y-3">
                {result.matches_in_perplexity.map((m) => (
                  <li key={m.keyword} className="border-l-2 border-zinc-200 pl-3">
                    <div className="text-sm">
                      <span className="font-mono">{m.keyword}</span>{" "}
                      <span
                        className={
                          m.count === 0
                            ? "text-red-700"
                            : m.count >= 3
                            ? "text-emerald-700"
                            : "text-amber-700"
                        }
                      >
                        → {m.count} {m.count === 1 ? "hit" : "hits"}
                      </span>
                    </div>
                    {m.snippets.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {m.snippets.map((s, i) => (
                          <li key={i} className="text-xs leading-relaxed text-ink-muted">
                            {s}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="card space-y-3 p-5">
              <h2 className="text-lg font-semibold text-ink">
                Citas de Perplexity ({result.perplexity.citations.length})
              </h2>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {result.perplexity.citations.map((c, i) => (
                  <li key={i}>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand underline"
                    >
                      {c.title || c.url}
                    </a>
                  </li>
                ))}
              </ol>
            </section>

            <section className="card space-y-3 p-5">
              <h2 className="text-lg font-semibold text-ink">
                Perplexity · contenido completo ({result.perplexity.content_chars} chars)
              </h2>
              <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-50 p-3 text-xs leading-relaxed text-ink">
                {result.perplexity.content_full}
              </pre>
            </section>

            <section className="card space-y-3 p-5">
              <h2 className="text-lg font-semibold text-ink">
                Claude · respuesta completa ({result.claude.response_chars} chars · modelo:{" "}
                {result.claude.model_used || "—"})
              </h2>
              {result.claude.error && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {result.claude.error}
                </p>
              )}
              <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-50 p-3 text-xs leading-relaxed text-ink">
                {result.claude.response_full}
              </pre>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
