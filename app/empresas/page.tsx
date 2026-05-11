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
  IconBuildingFactory2
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
  created_at: string;
};

const REGIONS: { value: string; label: string }[] = [
  { value: "US", label: "Estados Unidos" },
  { value: "CA", label: "Canadá" },
  { value: "EU", label: "Europa" },
  { value: "LATAM", label: "LATAM" }
];

const SIZES: { value: "small" | "medium" | "large"; label: string }[] = [
  { value: "small",  label: "5–30 empleados (sweet spot)" },
  { value: "medium", label: "31–100 empleados" },
  { value: "large",  label: "100+ empleados / DSOs" }
];

export default function EmpresasPage() {
  const [region, setRegion] = useState("US");
  const [size, setSize] = useState<"small" | "medium" | "large">("small");
  const [limit, setLimit] = useState(8);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{ inserted: number; skipped: number } | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/companies?status=${tab}`);
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Load failed");
      return;
    }
    setCompanies(data.companies);
  }

  useEffect(() => {
    load();
  }, [tab]);

  async function discover() {
    setDiscovering(true);
    setError(null);
    setLastRun(null);
    const res = await fetch("/api/companies/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region, size, limit })
    });
    const data = await res.json();
    setDiscovering(false);
    if (!res.ok) {
      setError(data.error ?? "Discovery failed");
      return;
    }
    setLastRun({ inserted: data.inserted?.length ?? 0, skipped: data.skipped ?? 0 });
    setTab("pending");
    load();
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
          <Field label="Tamaño objetivo">
            <select
              className="input"
              value={size}
              onChange={(e) => setSize(e.target.value as typeof size)}
            >
              {SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
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
          <div className="mt-3 text-sm text-success-fg flex items-center gap-2">
            <IconCheck size={14} /> {lastRun.inserted} nuevas insertadas
            {lastRun.skipped > 0 && ` · ${lastRun.skipped} duplicadas omitidas`}
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
          {(["pending", "approved", "rejected"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`btn ${
                tab === s
                  ? "bg-brand text-white"
                  : "bg-white border border-[#E5E2F0] text-ink hover:border-brand-soft"
              }`}
            >
              {s === "pending" ? "Pendientes" : s === "approved" ? "Aprobadas" : "Rechazadas"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <ScoreChip label="alto" color="success" count={counts.high ?? 0} />
          <ScoreChip label="medio" color="warning" count={counts.medium ?? 0} />
          <ScoreChip label="bajo" color="danger" count={counts.low ?? 0} />
          <button className="btn-secondary" onClick={load} disabled={loading}>
            <IconRefresh size={14} /> Refrescar
          </button>
        </div>
      </div>

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
