"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconSparkles,
  IconCheck,
  IconX,
  IconExternalLink,
  IconBrandLinkedin,
  IconRefresh,
  IconAlertCircle,
  IconBuildingFactory2,
  IconRocket,
  IconTrash
} from "@tabler/icons-react";

type Company = {
  id: string;
  company_name: string;
  company_website: string | null;
  company_linkedin_url: string | null;
  company_city: string | null;
  company_country: string | null;
  company_size: number | null;
  company_type: string | null;
  cad_software: string | null;
  scanner_technology: string | null;
  fit_signals: string | null;
  fit_score: "high" | "medium" | "low" | null;
  research_summary: string | null;
  research_sources: { title: string; url: string }[];
  competitor_match: string | null;
  status: string;
  reject_reason: string | null;
  clay_pushed_at: string | null;
  clay_push_error: string | null;
  hubspot_company_id: string | null;
  hubspot_synced_at: string | null;
  hubspot_sync_error: string | null;
  created_at: string;
};

const REGIONS: { value: string; label: string }[] = [
  { value: "US", label: "Estados Unidos" },
  { value: "CA", label: "Canadá" },
  { value: "EU", label: "Europa" },
  { value: "LATAM", label: "LATAM" }
];

type SizeOption = {
  key: string;
  min: number;
  max: number | null;
  note: string | null;
  label: string;
};

function sizeOptionFromRule(rule: {
  min: number;
  max: number | null;
  note?: string | null;
}): SizeOption {
  const range = rule.max === null ? `${rule.min}+ empleados` : `${rule.min}–${rule.max} empleados`;
  const label = rule.note ? `${range} · ${rule.note}` : range;
  return {
    key: `${rule.min}-${rule.max ?? "inf"}`,
    min: rule.min,
    max: rule.max ?? null,
    note: rule.note ?? null,
    label
  };
}

export default function EmpresasPage() {
  const [region, setRegion] = useState("US");
  const [sizeOptions, setSizeOptions] = useState<SizeOption[]>([]);
  const [sizeKey, setSizeKey] = useState<string>("");
  const [limit, setLimit] = useState(8);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [statusCounts, setStatusCounts] = useState<{ pending: number; approved: number; rejected: number }>({
    pending: 0,
    approved: 0,
    rejected: 0
  });
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{
    inserted: number;
    skipped: number;
    diagnostics?: {
      perplexity_asked: number;
      perplexity_content_chars: number;
      perplexity_content_preview: string;
      claude_model_used: string;
      claude_response_chars: number;
      claude_response_preview: string;
      claude_extracted: number;
      passed_name: number;
      passed_dedup: number;
      passed_linkedin_regex: number;
      passed_region: number;
      passed_linkedin_live: number;
      final: number;
      verify_linkedin_live: boolean;
      strict_region: boolean;
      retried: boolean;
    };
  } | null>(null);
  const [bulkPushing, setBulkPushing] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ pushed: number; total: number; errors: number } | null>(null);

  const unpushedCount = useMemo(
    () =>
      tab === "approved"
        ? companies.filter((c) => !c.clay_pushed_at).length
        : 0,
    [tab, companies]
  );

  async function pushAllToClay() {
    if (unpushedCount === 0) return;
    setBulkPushing(true);
    setBulkResult(null);
    setError(null);
    const res = await fetch("/api/clay/push-companies", { method: "POST" });
    const data = await res.json();
    setBulkPushing(false);
    if (!res.ok) {
      setError(data.error ?? "Error empujando empresas a Clay");
      return;
    }
    setBulkResult({
      pushed: data.pushed ?? 0,
      total: data.total ?? 0,
      errors: (data.errors ?? []).length
    });
    load("approved");
  }

  async function load(forStatus: "pending" | "approved" | "rejected" = tab) {
    setLoading(true);
    const res = await fetch(`/api/companies?status=${forStatus}`, { cache: "no-store" });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Load failed");
      return;
    }
    setCompanies(data.companies);
    if (data.counts) setStatusCounts(data.counts);
  }

  useEffect(() => {
    load();
  }, [tab]);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/icp", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.icp?.size_rules) return;
      const opts: SizeOption[] = (data.icp.size_rules as any[])
        .filter((r) => r.decision === "approve")
        .map((r) => sizeOptionFromRule(r));
      setSizeOptions(opts);
      if (opts.length > 0) {
        const sweet = opts.find((o) => /sweet/i.test(o.note ?? "")) ?? opts[0];
        setSizeKey(sweet.key);
      }
    })();
  }, []);

  async function discover() {
    setDiscovering(true);
    setError(null);
    setLastRun(null);
    const selected = sizeOptions.find((o) => o.key === sizeKey);
    if (!selected) {
      setDiscovering(false);
      setError("No hay reglas de tamaño aprobadas en el ICP. Configura una en /configuracion/icp.");
      return;
    }
    // 290s timeout: el endpoint tiene maxDuration=300, cortamos 10s antes
    // para mostrar un error claro en vez de quedarnos esperando un response
    // que Vercel ya mató.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 290_000);
    let res: Response;
    try {
      res = await fetch("/api/companies/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region,
          size_min: selected.min,
          size_max: selected.max,
          limit
        }),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeoutId);
      setDiscovering(false);
      const aborted = err instanceof DOMException && err.name === "AbortError";
      setError(
        aborted
          ? "La búsqueda tardó más de 5 minutos. Prueba con un límite menor (5-8) o reintenta."
          : err instanceof Error
          ? err.message
          : "Discovery failed"
      );
      return;
    }
    clearTimeout(timeoutId);
    const data = await res.json();
    setDiscovering(false);
    if (!res.ok) {
      setError(data.error ?? "Discovery failed");
      return;
    }
    setLastRun({
      inserted: data.inserted?.length ?? 0,
      skipped: data.skipped ?? 0,
      diagnostics: data.diagnostics
    });
    setTab("pending");
    load("pending");
  }

  const counts = useMemo(() => {
    const by: Record<string, number> = { high: 0, medium: 0, low: 0 };
    for (const c of companies) {
      if (c.fit_score) by[c.fit_score] = (by[c.fit_score] ?? 0) + 1;
    }
    return by;
  }, [companies]);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="label">Prospección</div>
          <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
          <div className="text-sm text-ink-muted mt-1">
            Investigación automática con Claude + Perplexity y revisión humana antes de buscar
            contactos.
          </div>
        </div>
      </header>

      <section className="card">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <IconSparkles size={18} className="text-brand" /> Recomendar empresas
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <Field label="Región">
            <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
              {REGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tamaño objetivo (desde ICP)">
            <select
              className="input"
              value={sizeKey}
              onChange={(e) => setSizeKey(e.target.value)}
              disabled={sizeOptions.length === 0}
            >
              {sizeOptions.length === 0 ? (
                <option value="">Cargando reglas del ICP…</option>
              ) : (
                sizeOptions.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))
              )}
            </select>
          </Field>
          <Field label="Máximo de empresas">
            <input
              type="number"
              min={1}
              max={15}
              className="input"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            />
          </Field>
          <div>
            <button onClick={discover} disabled={discovering} className="btn-primary w-full">
              <IconSparkles size={16} /> {discovering ? "Investigando…" : "Buscar nuevas empresas"}
            </button>
          </div>
        </div>
        {lastRun && (
          <div className="mt-3 space-y-2">
            <div
              className={`text-sm flex flex-wrap items-center gap-2 ${
                lastRun.inserted > 0 ? "text-success-fg" : "text-warning-fg"
              }`}
            >
              <IconCheck size={14} /> {lastRun.inserted} nuevas insertadas
              {lastRun.skipped > 0 && ` · ${lastRun.skipped} duplicadas omitidas`}
              {lastRun.diagnostics?.retried && " · reintento relajado activado"}
              {lastRun.diagnostics?.claude_model_used && (
                <span
                  className={`badge ${
                    /haiku/i.test(lastRun.diagnostics.claude_model_used)
                      ? "bg-warning-bg text-warning-fg"
                      : "bg-[#EEEDFE] text-brand"
                  }`}
                  title={`Modelo usado para extracción: ${lastRun.diagnostics.claude_model_used}`}
                >
                  modelo: {/haiku/i.test(lastRun.diagnostics.claude_model_used)
                    ? "Haiku (fallback)"
                    : "Sonnet"}
                </span>
              )}
            </div>
            {lastRun.diagnostics && (
              <details className="text-xs text-ink-muted">
                <summary className="cursor-pointer hover:text-ink">Ver embudo de filtros</summary>
                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <FunnelStep label="Perplexity solicitó" value={lastRun.diagnostics.perplexity_asked} />
                  <FunnelStep label="Claude extrajo" value={lastRun.diagnostics.claude_extracted} />
                  <FunnelStep label="Con nombre" value={lastRun.diagnostics.passed_name} />
                  <FunnelStep label="No duplicadas" value={lastRun.diagnostics.passed_dedup} />
                  <FunnelStep label="LinkedIn regex" value={lastRun.diagnostics.passed_linkedin_regex} />
                  <FunnelStep
                    label={
                      lastRun.diagnostics.strict_region
                        ? "Región estricta"
                        : "Región (solo prompt)"
                    }
                    value={lastRun.diagnostics.passed_region}
                  />
                  <FunnelStep
                    label={
                      lastRun.diagnostics.verify_linkedin_live
                        ? "LinkedIn live"
                        : "LinkedIn live (off)"
                    }
                    value={lastRun.diagnostics.passed_linkedin_live}
                  />
                  <FunnelStep label="Final (tras límite)" value={lastRun.diagnostics.final} />
                </div>
                <div className="mt-3">
                  <div className="label mb-1">
                    Perplexity devolvió {lastRun.diagnostics.perplexity_content_chars} caracteres ·
                    preview:
                  </div>
                  <pre className="bg-[#F4F2FB] rounded-md p-2 whitespace-pre-wrap break-words text-[11px] text-ink/80 max-h-48 overflow-auto">
                    {lastRun.diagnostics.perplexity_content_preview || "(vacío)"}
                  </pre>
                </div>
                <div className="mt-3">
                  <div className="label mb-1">
                    Claude respondió {lastRun.diagnostics.claude_response_chars} caracteres ·
                    preview:
                  </div>
                  <pre className="bg-[#F4F2FB] rounded-md p-2 whitespace-pre-wrap break-words text-[11px] text-ink/80 max-h-48 overflow-auto">
                    {lastRun.diagnostics.claude_response_preview || "(vacío)"}
                  </pre>
                </div>
              </details>
            )}
          </div>
        )}
        {error && (
          <div className="mt-3 text-sm text-danger-fg flex items-center gap-2">
            <IconAlertCircle size={14} /> {error}
          </div>
        )}
      </section>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {(["pending", "approved", "rejected"] as const).map((s) => {
            const label = s === "pending" ? "Pendientes" : s === "approved" ? "Aprobadas" : "Rechazadas";
            const count = statusCounts[s];
            const active = tab === s;
            return (
              <button
                key={s}
                onClick={() => setTab(s)}
                className={`btn ${
                  active
                    ? "bg-brand text-white"
                    : "bg-white border border-[#E5E2F0] text-ink hover:border-brand-soft"
                }`}
              >
                {label}
                <span
                  className={`ml-2 inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[11px] font-semibold ${
                    active ? "bg-white/20 text-white" : "bg-[#F1EEF7] text-ink-muted"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <ScoreChip label="alto" color="success" count={counts.high ?? 0} />
          <ScoreChip label="medio" color="warning" count={counts.medium ?? 0} />
          <ScoreChip label="bajo" color="danger" count={counts.low ?? 0} />
          {tab === "approved" && unpushedCount > 0 && (
            <button
              onClick={pushAllToClay}
              disabled={bulkPushing}
              className="btn-primary"
              title="Empuja a Clay todas las aprobadas que aún no fueron prospectadas"
            >
              <IconRocket size={14} />
              {bulkPushing
                ? "Prospectando…"
                : `Prospectar todas en Clay (${unpushedCount})`}
            </button>
          )}
          <button className="btn-secondary" onClick={() => load()} disabled={loading}>
            <IconRefresh size={14} /> Refrescar
          </button>
        </div>
      </div>

      {bulkResult && (
        <div className="card text-sm flex items-center gap-3">
          <IconCheck size={16} className="text-success-fg" />
          <span>
            {bulkResult.pushed} de {bulkResult.total} empresas empujadas a Clay
            {bulkResult.errors > 0 && ` · ${bulkResult.errors} con error`}
          </span>
        </div>
      )}

      {loading ? (
        <div className="text-ink-muted">Cargando…</div>
      ) : companies.length === 0 ? (
        <div className="card text-ink-muted flex items-center gap-2">
          <IconBuildingFactory2 size={18} />
          {tab === "pending"
            ? "No hay empresas pendientes. Corre una búsqueda nueva arriba."
            : `No hay empresas en estado ${tab}.`}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {companies.map((c) => (
            <CompanyCard key={c.id} c={c} onChange={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="label mb-1">{label}</div>
      {children}
    </label>
  );
}

function FunnelStep({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-[#F4F2FB] rounded-md px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className="text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

function ScoreChip({
  label,
  color,
  count
}: {
  label: string;
  color: "success" | "warning" | "danger";
  count: number;
}) {
  const map = {
    success: "bg-success-bg text-success-fg",
    warning: "bg-warning-bg text-warning-fg",
    danger: "bg-danger-bg text-danger-fg"
  } as const;
  return (
    <span className={`badge ${map[color]}`}>
      {label} · {count}
    </span>
  );
}

function CompanyCard({ c, onChange }: { c: Company; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [pushingClay, setPushingClay] = useState(false);
  const [clayError, setClayError] = useState<string | null>(c.clay_push_error);
  const [clayPushedAt, setClayPushedAt] = useState<string | null>(c.clay_pushed_at);
  const [deleting, setDeleting] = useState(false);
  const [pushingHubspot, setPushingHubspot] = useState(false);
  const [hubspotId, setHubspotId] = useState<string | null>(c.hubspot_company_id);
  const [hubspotError, setHubspotError] = useState<string | null>(c.hubspot_sync_error);

  async function pushToHubspot() {
    setPushingHubspot(true);
    setHubspotError(null);
    const res = await fetch(`/api/hubspot/push-company/${c.id}`, { method: "POST" });
    const data = await res.json();
    setPushingHubspot(false);
    if (!res.ok) {
      setHubspotError(data.error ?? "Error empujando a HubSpot");
      return;
    }
    if (data.hubspot_push?.ok === false) {
      setHubspotError(data.hubspot_push.error ?? "HubSpot rechazó la empresa");
      return;
    }
    setHubspotId(data.company?.hubspot_company_id ?? data.hubspot_push?.hubspot_id ?? null);
  }

  async function removeCompany() {
    const ok = window.confirm(
      `¿Eliminar a ${c.company_name} de la base?\n\nEsto borra la empresa, sus contactos asociados y el feedback histórico. No se puede deshacer.\n\nÚtil si la URL de LinkedIn está alucinada y prefieres que el discovery la pueda volver a recomendar más adelante.`
    );
    if (!ok) return;
    setDeleting(true);
    const res = await fetch(`/api/companies/${c.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) {
      const d = await res.json();
      alert(d.error ?? "No se pudo eliminar");
      return;
    }
    onChange();
  }

  async function decide(decision: "approved" | "rejected", reasonArg?: string) {
    setBusy(true);
    const res = await fetch(`/api/companies/${c.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason: reasonArg })
    });
    setBusy(false);
    if (res.ok) {
      onChange();
    } else {
      const d = await res.json();
      alert(d.error ?? "Error");
    }
  }

  async function pushToClay() {
    setPushingClay(true);
    setClayError(null);
    const res = await fetch("/api/clay/push-company", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: c.id })
    });
    const data = await res.json();
    setPushingClay(false);
    if (!res.ok) {
      setClayError(data.error ?? "Error empujando a Clay");
      return;
    }
    setClayPushedAt(data.company?.clay_pushed_at ?? new Date().toISOString());
  }

  const scoreClass =
    c.fit_score === "high"
      ? "bg-success-bg text-success-fg"
      : c.fit_score === "medium"
      ? "bg-warning-bg text-warning-fg"
      : "bg-danger-bg text-danger-fg";

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate">{c.company_name}</h3>
            {c.fit_score && (
              <span className={`badge ${scoreClass}`}>fit {c.fit_score}</span>
            )}
            {c.competitor_match && (
              <span className="badge bg-brand-tint text-brand">
                ya con {c.competitor_match}
              </span>
            )}
          </div>
          <div className="text-xs text-ink-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {c.company_type && <span>{labelType(c.company_type)}</span>}
            {c.company_size && <span>· {c.company_size} empleados</span>}
            {(c.company_city || c.company_country) && (
              <span>
                · {[c.company_city, c.company_country].filter(Boolean).join(", ")}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {c.company_website && (
            <a
              href={c.company_website}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
              title="Sitio web"
            >
              <IconExternalLink size={14} />
            </a>
          )}
          {c.company_linkedin_url && (
            <a
              href={c.company_linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
              title="LinkedIn"
            >
              <IconBrandLinkedin size={14} />
            </a>
          )}
        </div>
      </div>

      {c.fit_signals && (
        <div>
          <div className="label mb-1">Señales detectadas</div>
          <div className="text-sm">{c.fit_signals}</div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="label mb-1">CAD</div>
          <div>{c.cad_software || <span className="text-ink-subtle">—</span>}</div>
        </div>
        <div>
          <div className="label mb-1">Escáner</div>
          <div>{c.scanner_technology || <span className="text-ink-subtle">—</span>}</div>
        </div>
      </div>

      {c.research_summary && (
        <div>
          <div className="label mb-1">Razonamiento IA</div>
          <p className="text-sm text-ink/90">{c.research_summary}</p>
        </div>
      )}

      {c.research_sources && c.research_sources.length > 0 && (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer hover:text-ink">
            Fuentes ({c.research_sources.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {c.research_sources.slice(0, 8).map((s, i) => (
              <li key={i}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-brand truncate inline-block max-w-full"
                >
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      {c.reject_reason && (
        <div className="text-xs text-danger-fg bg-danger-bg rounded-md p-2">
          Rechazada: {c.reject_reason}
        </div>
      )}

      {c.status === "approved" && (
        <div className="flex flex-col gap-2 pt-1 border-t border-[#EEEDFE]">
          <div className="flex items-center gap-2 pt-2">
            {clayPushedAt ? (
              <div className="flex items-center gap-2 text-sm text-success-fg flex-1">
                <IconCheck size={14} />
                <span>
                  En Clay desde {new Date(clayPushedAt).toLocaleString("es", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </span>
              </div>
            ) : (
              <button
                onClick={pushToClay}
                disabled={pushingClay}
                className="btn-primary flex-1"
                title="POST a Clay Companies para que busque contactos"
              >
                <IconRocket size={14} />
                {pushingClay ? "Prospectando…" : "Prospectar en Clay"}
              </button>
            )}
          </div>
          {clayError && (
            <div className="text-xs text-danger-fg flex items-center gap-2">
              <IconAlertCircle size={14} /> {clayError}
            </div>
          )}
          <div className="flex items-center gap-2">
            {hubspotId ? (
              <div className="flex items-center gap-2 text-sm text-success-fg flex-1">
                <IconCheck size={14} />
                <span>En HubSpot ({hubspotId})</span>
                <button
                  onClick={pushToHubspot}
                  disabled={pushingHubspot}
                  className="btn-secondary text-xs ml-auto"
                  title="Re-sincronizar (idempotente: actualiza los wecad_* fields)"
                >
                  {pushingHubspot ? "…" : "Resync"}
                </button>
              </div>
            ) : (
              <button
                onClick={pushToHubspot}
                disabled={pushingHubspot}
                className="btn-secondary flex-1"
                title="Crea la empresa en HubSpot con los wecad_* fields"
              >
                <IconRocket size={14} />
                {pushingHubspot ? "Sincronizando…" : "Sincronizar a HubSpot"}
              </button>
            )}
          </div>
          {hubspotError && (
            <div className="text-xs text-danger-fg flex items-center gap-2">
              <IconAlertCircle size={14} /> HubSpot: {hubspotError}
            </div>
          )}
          {rejecting ? (
            <div className="flex items-center gap-2">
              <input
                className="input"
                placeholder="Razón del rechazo"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
              />
              <button
                onClick={() => decide("rejected", reason)}
                disabled={busy || !reason.trim()}
                className="btn-danger"
              >
                <IconX size={14} /> Confirmar
              </button>
              <button
                onClick={() => {
                  setRejecting(false);
                  setReason("");
                }}
                disabled={busy}
                className="btn-secondary"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setRejecting(true)}
              disabled={busy}
              className="text-xs text-ink-muted hover:text-danger-fg self-start inline-flex items-center gap-1"
              title="Mover esta empresa a rechazadas"
            >
              <IconX size={12} /> Mover a rechazadas
            </button>
          )}
        </div>
      )}

      {c.status === "pending" && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => decide("approved")}
            disabled={busy}
            className="btn-primary flex-1"
          >
            <IconCheck size={14} /> Aprobar
          </button>
          {rejecting ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                className="input"
                placeholder="Razón"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                onClick={() => decide("rejected", reason)}
                disabled={busy || !reason.trim()}
                className="btn-danger"
              >
                <IconX size={14} /> Confirmar
              </button>
            </div>
          ) : (
            <button onClick={() => setRejecting(true)} className="btn-danger flex-1">
              <IconX size={14} /> Rechazar
            </button>
          )}
        </div>
      )}
      <div className="flex justify-end pt-1">
        <button
          onClick={removeCompany}
          disabled={deleting}
          className="text-xs text-ink-muted hover:text-danger-fg inline-flex items-center gap-1"
          title="Eliminar de la base. La empresa puede volver a ser recomendada por discovery."
        >
          <IconTrash size={12} />
          {deleting ? "Eliminando…" : "Eliminar"}
        </button>
      </div>
    </div>
  );
}

function labelType(t: string) {
  return t === "lab"
    ? "Laboratorio dental"
    : t === "multi_clinic"
    ? "Clínica multi-centro"
    : t === "dso"
    ? "DSO"
    : t;
}
