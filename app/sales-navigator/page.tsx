"use client";

import { useEffect, useState, useCallback } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconAlertCircle,
  IconRefresh,
  IconExternalLink,
  IconLoader2,
  IconCheck,
  IconX,
  IconDownload,
  IconSearch
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
  research_summary: string | null;
  fit_score: "high" | "medium" | "low" | null;
  clay_pushed_at: string | null;
  clay_no_contacts_at: string | null;
  sales_nav_status: string | null;
  created_at: string;
};

type NoContactItem = {
  company: Company;
  contact_count: number;
  signal: "clay" | "inferred";
  recent: boolean;
};

type OneContactItem = {
  company: Company;
  contact_count: number;
};

type NoFitItem = {
  company: Company;
  contact_count: number;
};

type SalesNavData = {
  no_contacts: NoContactItem[];
  one_contact: OneContactItem[];
  no_fit: NoFitItem[];
};

type ImportResult = {
  summary?: { yes: number; no: number };
  matched_count?: number;
  staged_leads?: Array<{ name: string; email?: string }>;
  staged_total?: number;
  error?: string;
};

type Tab = "no_contacts" | "one_contact" | "no_fit";

export default function SalesNavigatorPage() {
  const { currentClient } = useClient();
  const [data, setData] = useState<SalesNavData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("no_contacts");
  const [includeRecent, setIncludeRecent] = useState(false);

  const load = useCallback(async () => {
    if (!currentClient) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ client_id: currentClient.id });
      if (includeRecent) params.set("include_recent", "1");
      const res = await fetch(`/api/sales-navigator?${params}`, {
        cache: "no-store"
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Error cargando datos");
      } else {
        setData(json);
      }
    } catch {
      setError("Error de red al cargar Sales Navigator");
    }
    setLoading(false);
  }, [currentClient, includeRecent]);

  useEffect(() => {
    load();
  }, [load]);

  const noContactsCount = data?.no_contacts.length ?? 0;
  const oneContactCount = data?.one_contact.length ?? 0;
  const noFitCount = data?.no_fit.length ?? 0;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "no_contacts", label: "Sin contactos", count: noContactsCount },
    { key: "one_contact", label: "Solo 1 contacto", count: oneContactCount },
    { key: "no_fit", label: "Sin contactos fit", count: noFitCount }
  ];

  return (
    <div className="space-y-6">
      {!currentClient && (
        <div className="card flex items-center gap-3 border border-warning-bg bg-warning-bg/40 text-warning-fg text-sm">
          <IconAlertCircle size={16} className="shrink-0" />
          Selecciona un cliente en el sidebar para ver las empresas de Sales Navigator.
        </div>
      )}

      <header className="flex items-end justify-between">
        <div>
          <div className="label">Prospección</div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales Navigator</h1>
          <div className="text-sm text-ink-muted mt-1">
            Empresas que Clay no pudo prospectar — buscalas a mano en LinkedIn.
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading || !currentClient}
          className="btn-secondary"
          title="Refrescar datos"
        >
          {loading ? (
            <IconLoader2 size={15} className="animate-spin" />
          ) : (
            <IconRefresh size={15} />
          )}
          Refrescar
        </button>
      </header>

      {currentClient && (
        <>
          {/* Tabs + toggle */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`btn ${
                  activeTab === t.key
                    ? "bg-brand text-white"
                    : "bg-white border border-[#E5E2F0] text-ink hover:border-brand-soft"
                }`}
              >
                {t.label}
                <span
                  className={`ml-1 inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[11px] font-semibold ${
                    activeTab === t.key
                      ? "bg-white/20 text-white"
                      : "bg-[#F1EEF7] text-ink-muted"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            ))}
            </div>
            <button
              onClick={() => setIncludeRecent(v => !v)}
              className={`btn text-xs ${includeRecent ? "bg-brand text-white" : "bg-white border border-[#E5E2F0] text-ink-muted hover:border-brand-soft"}`}
              title="Por defecto se esperan 24h desde que la empresa fue a Clay, para no mostrar las que Clay todavía está procesando."
            >
              Incluir las recién mandadas a Clay
            </button>
          </div>

          {error && (
            <div className="card flex items-center gap-3 border border-danger-bg bg-danger-bg/40 text-danger-fg text-sm">
              <IconAlertCircle size={16} className="shrink-0" />
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-3 text-ink-muted py-10 justify-center">
              <IconLoader2 size={22} className="animate-spin" />
              <span>Cargando empresas…</span>
            </div>
          ) : (
            <>
              {activeTab === "no_contacts" && (
                <NoContactsList
                  items={data?.no_contacts ?? []}
                  onReload={load}
                />
              )}
              {activeTab === "one_contact" && (
                <OneContactList
                  items={data?.one_contact ?? []}
                  onReload={load}
                />
              )}
              {activeTab === "no_fit" && (
                <NoFitList items={data?.no_fit ?? []} onReload={load} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function NoContactsList({
  items,
  onReload
}: {
  items: NoContactItem[];
  onReload: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="card flex items-center gap-3 text-ink-muted">
        <IconCheck size={18} className="text-success-fg" />
        No hay empresas sin contactos. Clay está encontrando personas en todas.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {items.map((item) => (
        <CompanyCard
          key={item.company.id}
          company={item.company}
          signal={item.signal}
          recent={item.recent}
          onReload={onReload}
          showMarkNoFit
        />
      ))}
    </div>
  );
}

function OneContactList({
  items,
  onReload
}: {
  items: OneContactItem[];
  onReload: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="card flex items-center gap-3 text-ink-muted">
        <IconCheck size={18} className="text-success-fg" />
        No hay empresas con un solo contacto.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {items.map((item) => (
        <CompanyCard
          key={item.company.id}
          company={item.company}
          signal="clay"
          recent={false}
          onReload={onReload}
          showMarkNoFit
        />
      ))}
    </div>
  );
}

function NoFitList({
  items,
  onReload
}: {
  items: NoFitItem[];
  onReload: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="card flex items-center gap-3 text-ink-muted">
        <IconCheck size={18} className="text-success-fg" />
        No hay empresas marcadas como sin contactos fit.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {items.map((item) => (
        <NoFitCard key={item.company.id} company={item.company} onReload={onReload} />
      ))}
    </div>
  );
}

function CompanyCard({
  company,
  signal,
  recent,
  onReload,
  showMarkNoFit
}: {
  company: Company;
  signal: "clay" | "inferred";
  recent: boolean;
  onReload: () => void;
  showMarkNoFit?: boolean;
}) {
  const [importing, setImporting] = useState(false);
  const [markingNoFit, setMarkingNoFit] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importAllLoading, setImportAllLoading] = useState(false);

  const salesNavUrl = `https://www.linkedin.com/sales/search/people?keywords=${encodeURIComponent(
    company.company_name
  )}`;

  async function handleImport(all = false) {
    if (all) {
      setImportAllLoading(true);
    } else {
      setImporting(true);
      setImportResult(null);
    }
    try {
      const url = `/api/sales-navigator/${company.id}/import${all ? "?all=1" : ""}`;
      const res = await fetch(url, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setImportResult({ error: json.error ?? `Error ${res.status}` });
      } else {
        setImportResult(json);
        if (json.summary?.yes > 0) {
          setTimeout(() => onReload(), 1500);
        }
      }
    } catch {
      setImportResult({ error: "Error de red al importar" });
    }
    setImporting(false);
    setImportAllLoading(false);
  }

  async function handleMarkNoFit() {
    setMarkingNoFit(true);
    try {
      await fetch(`/api/sales-navigator/${company.id}/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "no_fit" })
      });
      onReload();
    } catch {
      // silencia error — reload mostrará el estado actualizado
    }
    setMarkingNoFit(false);
  }

  const locationParts = [
    company.company_size ? `${company.company_size} empleados` : null,
    company.company_city,
    company.company_country
  ].filter(Boolean);

  return (
    <div className="card flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className={`badge ${
                signal === "clay"
                  ? "bg-brand-tint text-brand"
                  : "bg-warning-bg text-warning-fg"
              }`}
            >
              {signal === "clay" ? "Clay" : "Inferido"}
            </span>
            <h3 className="font-semibold">{company.company_name}</h3>
          </div>
          {locationParts.length > 0 && (
            <div className="text-xs text-ink-muted">
              {locationParts.join(" · ")}
            </div>
          )}
        </div>
      </div>

      {/* Aviso si reciente */}
      {recent && (
        <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-warning-bg text-warning-fg">
          <IconAlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            Pusheada a Clay hace menos de 24h — verificá antes de buscar a mano.
          </span>
        </div>
      )}

      {/* Señales */}
      {company.fit_signals && (
        <div>
          <div className="label mb-1">Señales</div>
          <p className="text-sm text-ink/90">{company.fit_signals}</p>
        </div>
      )}

      {/* Instrucciones */}
      <div className="rounded-lg p-3 text-xs space-y-1.5" style={{ background: "rgba(37,23,98,0.04)", border: "1px solid rgba(37,23,98,0.08)" }}>
        <div className="font-semibold text-ink-muted uppercase tracking-wide mb-2">Pasos</div>
        <div className="flex gap-2">
          <span className="font-bold text-brand shrink-0">1.</span>
          <span>Hacé clic en "Abrir en Sales Nav" abajo</span>
        </div>
        <div className="flex gap-2">
          <span className="font-bold text-brand shrink-0">2.</span>
          <span>Buscá decisores fit y mandálos a la Campaña puente con la extensión de Lemlist.</span>
        </div>
        <div className="flex gap-2">
          <span className="font-bold text-brand shrink-0">3.</span>
          <span>Volvé acá y clic "Importar desde puente".</span>
        </div>
      </div>

      {/* Botones de acción */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 flex-wrap">
          <a
            href={salesNavUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-primary flex-1 justify-center"
          >
            <IconSearch size={15} /> Abrir en Sales Navigator
          </a>
          <button
            onClick={() => handleImport(false)}
            disabled={importing}
            className="btn-secondary flex-1"
          >
            {importing ? (
              <IconLoader2 size={15} className="animate-spin" />
            ) : (
              <IconDownload size={15} />
            )}
            {importing ? "Importando…" : "Importar desde Campaña puente"}
          </button>
        </div>
        {showMarkNoFit && (
          <button
            onClick={handleMarkNoFit}
            disabled={markingNoFit}
            className="btn-danger self-start text-xs"
          >
            {markingNoFit ? (
              <IconLoader2 size={13} className="animate-spin" />
            ) : (
              <IconX size={13} />
            )}
            Sin contactos fit
          </button>
        )}
      </div>

      {/* Resultado de importación inline */}
      {importResult && (
        <div>
          {importResult.error ? (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-danger-bg text-danger-fg">
              <IconAlertCircle size={15} className="shrink-0" />
              {importResult.error}
            </div>
          ) : importResult.summary && importResult.summary.yes > 0 ? (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-success-bg text-success-fg">
              <IconCheck size={15} className="shrink-0" />
              {importResult.summary.yes} contactos importados · {importResult.summary.no} no pasaron
              pre-filter
            </div>
          ) : importResult.matched_count === 0 ? (
            <div className="rounded-lg p-3 text-sm space-y-2 bg-[#F4F2FB] border border-[#E5E2F0]">
              <div className="text-ink-muted text-xs font-medium uppercase tracking-wide">
                Sin coincidencias — leads en espera ({importResult.staged_total ?? 0})
              </div>
              {importResult.staged_leads && importResult.staged_leads.length > 0 && (
                <ul className="space-y-1 text-xs text-ink">
                  {importResult.staged_leads.slice(0, 5).map((l, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-soft shrink-0" />
                      {l.name}
                      {l.email && <span className="text-ink-muted">{l.email}</span>}
                    </li>
                  ))}
                  {(importResult.staged_total ?? 0) > 5 && (
                    <li className="text-ink-muted">
                      +{(importResult.staged_total ?? 0) - 5} más…
                    </li>
                  )}
                </ul>
              )}
              <button
                onClick={() => handleImport(true)}
                disabled={importAllLoading}
                className="btn-primary text-xs"
              >
                {importAllLoading ? (
                  <IconLoader2 size={13} className="animate-spin" />
                ) : (
                  <IconDownload size={13} />
                )}
                {importAllLoading
                  ? "Importando…"
                  : `Importar ${importResult.staged_total ?? 0} de todas formas`}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function NoFitCard({
  company,
  onReload
}: {
  company: Company;
  onReload: () => void;
}) {
  const [unmarking, setUnmarking] = useState(false);

  async function handleUnmark() {
    setUnmarking(true);
    try {
      await fetch(`/api/sales-navigator/${company.id}/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: null })
      });
      onReload();
    } catch {
      // silencia — reload muestra estado
    }
    setUnmarking(false);
  }

  const locationParts = [
    company.company_size ? `${company.company_size} empleados` : null,
    company.company_city,
    company.company_country
  ].filter(Boolean);

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{company.company_name}</h3>
          {locationParts.length > 0 && (
            <div className="text-xs text-ink-muted mt-1">{locationParts.join(" · ")}</div>
          )}
        </div>
        <span className="badge bg-danger-bg text-danger-fg shrink-0">sin fit</span>
      </div>
      {company.fit_signals && (
        <p className="text-sm text-ink/80">{company.fit_signals}</p>
      )}
      <button
        onClick={handleUnmark}
        disabled={unmarking}
        className="btn-secondary self-start text-xs"
      >
        {unmarking ? <IconLoader2 size={13} className="animate-spin" /> : <IconX size={13} />}
        Quitar de sin fit
      </button>
    </div>
  );
}
