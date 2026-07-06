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
  IconSearch,
  IconCopy,
  IconUsers
} from "@tabler/icons-react";

const LEMLIST_PEOPLE_URL = "https://app.lemlist.com/teams/tea_zDQ9NtFnZoLT6nGuc/people-database";

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

type FewContactItem = {
  company: Company;
  contact_count: number;
};

type NoFitItem = {
  company: Company;
  contact_count: number;
};

type ManualData = {
  no_contacts: NoContactItem[];
  few_contacts: FewContactItem[];
  no_fit: NoFitItem[];
};

type StagingLead = {
  key: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  companyName: string;
  linkedinUrl: string | null;
  email: string | null;
  matched: boolean;
};

type ImportResult = {
  summary?: { yes: number; no: number; duplicates?: number };
  staged_total?: number;
  error?: string;
};

type Tab = "no_contacts" | "few_contacts" | "no_fit";

export default function ProspeccionManualPage() {
  const { currentClient } = useClient();
  const [data, setData] = useState<ManualData | null>(null);
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
      const res = await fetch(`/api/sales-navigator?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Error cargando datos");
      } else {
        setData(json);
      }
    } catch {
      setError("Error de red al cargar datos");
    }
    setLoading(false);
  }, [currentClient, includeRecent]);

  useEffect(() => { load(); }, [load]);

  const noContactsCount  = data?.no_contacts.length ?? 0;
  const fewContactsCount = data?.few_contacts.length ?? 0;
  const noFitCount       = data?.no_fit.length ?? 0;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "no_contacts",  label: "Sin contactos",      count: noContactsCount  },
    { key: "few_contacts", label: "Pocos contactos (1–3)", count: fewContactsCount },
    { key: "no_fit",       label: "Sin contactos fit",  count: noFitCount       }
  ];

  return (
    <div className="space-y-6">
      {!currentClient && (
        <div className="card flex items-center gap-3 border border-warning-bg bg-warning-bg/40 text-warning-fg text-sm">
          <IconAlertCircle size={16} className="shrink-0" />
          Selecciona un cliente en el sidebar para ver las empresas.
        </div>
      )}

      <header className="flex items-end justify-between">
        <div>
          <div className="label">Prospección</div>
          <h1 className="text-2xl font-semibold tracking-tight">Prospección Manual</h1>
          <div className="text-sm text-ink-muted mt-1">
            Empresas con pocos o ningún contacto — búscalos en Lemlist o Sales Navigator.
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading || !currentClient}
          className="btn-secondary"
          title="Refrescar datos"
        >
          {loading ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />}
          Refrescar
        </button>
      </header>

      {currentClient && (
        <>
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
                      activeTab === t.key ? "bg-white/20 text-white" : "bg-[#F1EEF7] text-ink-muted"
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
              title="Por defecto se esperan 24h desde que la empresa fue a Clay."
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
                <CompanyList
                  items={data?.no_contacts ?? []}
                  emptyMsg="No hay empresas sin contactos. Clay está encontrando personas en todas."
                  onReload={load}
                  showMarkNoFit
                />
              )}
              {activeTab === "few_contacts" && (
                <FewContactsList items={data?.few_contacts ?? []} onReload={load} />
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

function CompanyList({
  items,
  emptyMsg,
  onReload,
  showMarkNoFit
}: {
  items: (NoContactItem | FewContactItem)[];
  emptyMsg: string;
  onReload: () => void;
  showMarkNoFit?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="card flex items-center gap-3 text-ink-muted">
        <IconCheck size={18} className="text-success-fg" />
        {emptyMsg}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {items.map((item) => (
        <CompanyCard
          key={item.company.id}
          company={item.company}
          contactCount={item.contact_count}
          signal={"signal" in item ? item.signal : "clay"}
          recent={"recent" in item ? item.recent : false}
          onReload={onReload}
          showMarkNoFit={showMarkNoFit}
        />
      ))}
    </div>
  );
}

function FewContactsList({ items, onReload }: { items: FewContactItem[]; onReload: () => void }) {
  const [filterCount, setFilterCount] = useState<number | null>(null);

  if (items.length === 0) {
    return (
      <div className="card flex items-center gap-3 text-ink-muted">
        <IconCheck size={18} className="text-success-fg" />
        No hay empresas con pocos contactos (1–3).
      </div>
    );
  }

  const filtered = filterCount === null ? items : items.filter(i => i.contact_count === filterCount);
  const counts = [1, 2, 3].filter(n => items.some(i => i.contact_count === n));

  return (
    <div className="space-y-4">
      {/* Filtro por número de contactos */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-muted">Filtrar:</span>
        <button
          onClick={() => setFilterCount(null)}
          className={`btn text-xs py-1 ${filterCount === null ? "bg-brand text-white" : "bg-white border border-[#E5E2F0] text-ink-muted"}`}
        >
          Todos ({items.length})
        </button>
        {counts.map(n => (
          <button
            key={n}
            onClick={() => setFilterCount(filterCount === n ? null : n)}
            className={`btn text-xs py-1 ${filterCount === n ? "bg-brand text-white" : "bg-white border border-[#E5E2F0] text-ink-muted"}`}
          >
            {n} {n === 1 ? "contacto" : "contactos"} ({items.filter(i => i.contact_count === n).length})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.map((item) => (
          <CompanyCard
            key={item.company.id}
            company={item.company}
            contactCount={item.contact_count}
            signal="clay"
            recent={false}
            onReload={onReload}
            showMarkNoFit
          />
        ))}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <button
      onClick={handleCopy}
      title="Copiar nombre de empresa"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors"
      style={copied
        ? { background: "rgba(98,224,216,0.15)", color: "#16a34a" }
        : { background: "rgba(37,23,98,0.06)", color: "#6b7280" }
      }
    >
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

function CompanyCard({
  company,
  contactCount,
  signal,
  recent,
  onReload,
  showMarkNoFit
}: {
  company: Company;
  contactCount: number;
  signal: "clay" | "inferred";
  recent: boolean;
  onReload: () => void;
  showMarkNoFit?: boolean;
}) {
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [stagingLeads, setStagingLeads] = useState<StagingLead[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [leadsFilter, setLeadsFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [markingNoFit, setMarkingNoFit] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const salesNavUrl = `https://www.linkedin.com/sales/search/people?keywords=${encodeURIComponent(company.company_name)}`;

  async function handleFetchLeads() {
    setLoadingLeads(true);
    setImportResult(null);
    setStagingLeads(null);
    try {
      const res  = await fetch(`/api/sales-navigator/${company.id}/import`);
      const json = await res.json();
      if (!res.ok) {
        setImportResult({ error: json.error ?? `Error ${res.status}` });
      } else {
        const leads: StagingLead[] = json.leads ?? [];
        setStagingLeads(leads);
        setSelectedKeys(new Set(leads.filter(l => l.matched).map(l => l.key)));
      }
    } catch {
      setImportResult({ error: "Error de red al cargar leads" });
    }
    setLoadingLeads(false);
  }

  async function handleImport() {
    setImporting(true);
    try {
      const res = await fetch(`/api/sales-navigator/${company.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_keys: Array.from(selectedKeys) }),
      });
      const json = await res.json();
      if (!res.ok) {
        setImportResult({ error: json.error ?? `Error ${res.status}` });
      } else {
        setImportResult(json);
        setStagingLeads(null);
        if (json.summary?.yes > 0) setTimeout(() => onReload(), 1500);
      }
    } catch {
      setImportResult({ error: "Error de red al importar" });
    }
    setImporting(false);
  }

  function toggleKey(key: string) {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
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
    } catch { /* silencia — reload muestra estado actualizado */ }
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
            <span className={`badge ${signal === "clay" ? "bg-brand-tint text-brand" : "bg-warning-bg text-warning-fg"}`}>
              {signal === "clay" ? "Clay" : "Inferido"}
            </span>
            {contactCount > 0 && (
              <span className="badge bg-[#F1EEF7] text-ink-muted flex items-center gap-1">
                <IconUsers size={11} />
                {contactCount} {contactCount === 1 ? "contacto" : "contactos"}
              </span>
            )}
            <h3 className="font-semibold">{company.company_name}</h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {locationParts.length > 0 && (
              <span className="text-xs text-ink-muted">{locationParts.join(" · ")}</span>
            )}
            <CopyButton text={company.company_name} />
          </div>
        </div>
      </div>

      {/* Aviso si reciente */}
      {recent && (
        <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-warning-bg text-warning-fg">
          <IconAlertCircle size={14} className="shrink-0 mt-0.5" />
          Recién mandada a Clay (hace menos de 24h) y todavía sin contactos. Puede que Clay siga procesándola — verifica en Clay antes de buscar a mano.
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
      <div className="rounded-lg p-3 text-xs space-y-2" style={{ background: "rgba(37,23,98,0.04)", border: "1px solid rgba(37,23,98,0.08)" }}>
        <div className="font-semibold text-ink-muted uppercase tracking-wide mb-1">Cómo traer los contactos</div>
        <div className="flex gap-2">
          <span className="font-bold text-brand shrink-0">1.</span>
          <span><strong>Primero Lemlist People</strong> (es más barato): abrí <strong>"Buscar en Lemlist People"</strong>, filtrá por nombre de la empresa y rol (Owner, Director, etc.), seleccioná los fit y con la extensión de Lemlist mandalos a la <strong>Campaña puente</strong>.</span>
        </div>
        <div className="flex gap-2">
          <span className="font-bold text-brand shrink-0">2.</span>
          <span><strong>Si Lemlist no tiene</strong>, abrí <strong>"Si no, en Sales Navigator"</strong> y repetí el mismo proceso. Sales Nav es la red más rica pero consume tu cuota más cara.</span>
        </div>
        <div className="flex gap-2">
          <span className="font-bold text-brand shrink-0">3.</span>
          <span>Volvé aquí y hacé clic en <strong>"Importar desde Campaña puente"</strong>. La app te muestra los leads para que confirmes cuáles son de esta empresa, los pre-filtra con IA, y los borra de la puente.</span>
        </div>
      </div>

      {/* Botones de acción */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 flex-wrap">
          <a
            href={LEMLIST_PEOPLE_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-primary flex-1 justify-center"
          >
            <IconSearch size={15} /> 1. Buscar en Lemlist People
          </a>
          <a
            href={salesNavUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary flex-1 justify-center"
          >
            <IconExternalLink size={15} /> 2. Si no, en Sales Navigator
          </a>
        </div>
        {!stagingLeads && (
          <button
            onClick={handleFetchLeads}
            disabled={loadingLeads}
            className="btn-secondary w-full justify-center"
          >
            {loadingLeads ? <IconLoader2 size={15} className="animate-spin" /> : <IconDownload size={15} />}
            {loadingLeads ? "Cargando…" : "Importar desde Campaña puente"}
          </button>
        )}
        {showMarkNoFit && !stagingLeads && (
          <button
            onClick={handleMarkNoFit}
            disabled={markingNoFit}
            className="btn-danger self-start text-xs"
          >
            {markingNoFit ? <IconLoader2 size={13} className="animate-spin" /> : <IconX size={13} />}
            No hay contactos fit
          </button>
        )}
      </div>

      {/* Lista de leads de la campaña puente */}
      {stagingLeads && (
        <div className="rounded-lg border border-[#E5E2F0] bg-[#F9F8FC] overflow-hidden">
          <div className="px-3 py-2 border-b border-[#E5E2F0] flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wide">
              Leads en la campaña puente ({stagingLeads.length})
            </span>
            <div className="flex gap-2 text-xs">
              <button onClick={() => setSelectedKeys(new Set(stagingLeads.map(l => l.key)))} className="text-brand hover:underline">Marcar todos</button>
              <span className="text-ink-muted">·</span>
              <button onClick={() => setSelectedKeys(new Set())} className="text-brand hover:underline">Desmarcar todos</button>
            </div>
          </div>
          <div className="px-3 py-2 border-b border-[#E5E2F0]">
            <input
              type="text"
              placeholder='Filtrar por nombre, empresa o cargo (ej: "Director")'
              value={leadsFilter}
              onChange={e => setLeadsFilter(e.target.value)}
              className="w-full text-xs rounded-md border border-[#D8D5EA] px-2.5 py-1.5 bg-white placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div className="divide-y divide-[#E5E2F0] max-h-72 overflow-y-auto">
            {stagingLeads
              .filter(l => {
                if (!leadsFilter.trim()) return true;
                const q = leadsFilter.toLowerCase();
                return (
                  `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
                  l.companyName.toLowerCase().includes(q) ||
                  l.jobTitle.toLowerCase().includes(q)
                );
              })
              .map(lead => (
                <label key={lead.key} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-white transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(lead.key)}
                    onChange={() => toggleKey(lead.key)}
                    className="mt-0.5 accent-[#62E0D8] shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink leading-tight">
                      {(lead.firstName || lead.lastName)
                        ? `${lead.firstName} ${lead.lastName}`.trim()
                        : (lead.email ?? lead.linkedinUrl ?? "Sin nombre")}
                      {lead.jobTitle && <span className="font-normal text-ink-muted"> · {lead.jobTitle}</span>}
                    </div>
                    {lead.companyName && <div className="text-xs text-ink-muted mt-0.5">{lead.companyName}</div>}
                  </div>
                </label>
              ))}
          </div>
          <div className="px-3 py-2.5 border-t border-[#E5E2F0] flex gap-2 items-center">
            <button
              onClick={handleImport}
              disabled={importing || selectedKeys.size === 0}
              className="btn-primary text-xs flex-1 justify-center"
            >
              {importing ? <IconLoader2 size={13} className="animate-spin" /> : <IconDownload size={13} />}
              {importing ? "Importando…" : `Importar y enviar a Lemlist (${selectedKeys.size})`}
            </button>
            <button onClick={() => { setStagingLeads(null); setLeadsFilter(""); setImportResult(null); }} className="text-xs text-ink-muted hover:text-ink">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Resultado */}
      {importResult && !stagingLeads && (
        <div>
          {importResult.error ? (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-danger-bg text-danger-fg">
              <IconAlertCircle size={15} className="shrink-0" />
              {importResult.error}
            </div>
          ) : importResult.summary && importResult.summary.yes > 0 ? (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-success-bg text-success-fg">
              <IconCheck size={15} className="shrink-0" />
              {importResult.summary.yes} contactos importados · {importResult.summary.no} no pasaron pre-filter
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-warning-bg text-warning-fg">
              <IconAlertCircle size={15} className="shrink-0" />
              0 contactos importados
              {importResult.summary?.duplicates ? ` — ${importResult.summary.duplicates} ya existían en otra empresa de este cliente` : ""}
              {importResult.summary?.no ? ` — ${importResult.summary.no} no pasaron el pre-filter` : ""}
              {!importResult.summary?.duplicates && !importResult.summary?.no ? " — revisá si ya estaban cargados en esta empresa" : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NoFitList({ items, onReload }: { items: NoFitItem[]; onReload: () => void }) {
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

function NoFitCard({ company, onReload }: { company: Company; onReload: () => void }) {
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
    } catch { /* silencia */ }
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
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-semibold">{company.company_name}</h3>
            <CopyButton text={company.company_name} />
          </div>
          {locationParts.length > 0 && (
            <div className="text-xs text-ink-muted">{locationParts.join(" · ")}</div>
          )}
        </div>
        <span className="badge bg-danger-bg text-danger-fg shrink-0">sin fit</span>
      </div>
      {company.fit_signals && <p className="text-sm text-ink/80">{company.fit_signals}</p>}
      <button onClick={handleUnmark} disabled={unmarking} className="btn-secondary self-start text-xs">
        {unmarking ? <IconLoader2 size={13} className="animate-spin" /> : <IconX size={13} />}
        Quitar de sin fit
      </button>
    </div>
  );
}
