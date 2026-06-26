"use client";

import { useEffect, useMemo, useState } from "react";
import { useClient } from "@/lib/clientContext";
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
  IconLoader2,
  IconMicroscope,
  IconBolt,
  IconTarget,
  IconUser,
  IconUpload,
  IconSearch,
  IconPencil
} from "@tabler/icons-react";
import { deserializeIcpForm } from "@/lib/icp-form";

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
  deep_research: string | null;
  status: string;
  reject_reason: string | null;
  clay_pushed_at: string | null;
  clay_push_error: string | null;
  created_at: string;
};

type DeepResearch = {
  trigger: string;
  angulo: string;
  senales: string[];
  decisores: string[];
  resumen_ejecutivo: string;
  fuentes: { title: string; url: string }[];
};

const ALL_REGIONS: { value: string; label: string }[] = [
  { value: "LATAM",     label: "LATAM" },
  { value: "CL",        label: "Chile" },
  { value: "MX",        label: "México" },
  { value: "PE",        label: "Perú" },
  { value: "CO",        label: "Colombia" },
  { value: "AR",        label: "Argentina" },
  { value: "EC",        label: "Ecuador" },
  { value: "GT",        label: "Guatemala" },
  { value: "BO",        label: "Bolivia" },
  { value: "SV",        label: "El Salvador" },
  { value: "HN",        label: "Honduras" },
  { value: "CR",        label: "Costa Rica" },
  { value: "PA",        label: "Panamá" },
  { value: "DO",        label: "República Dominicana" },
  { value: "UY",        label: "Uruguay" },
  { value: "PY",        label: "Paraguay" },
  { value: "US",        label: "Estados Unidos" },
  { value: "ES",        label: "España" },
  { value: "BR",        label: "Brasil" },
  { value: "GLOBAL",    label: "Global" },
];

// Convierte un chip de tamaño del ICP (ej "51–100") a hint de empleados para el prompt
function chipToSizeHint(chip: string): string {
  if (chip.endsWith("+")) {
    const num = chip.replace(".", "").replace("+", "");
    return `empresas con más de ${num} empleados`;
  }
  const parts = chip.split("–");
  if (parts.length === 2) return `empresas con ${parts[0]} a ${parts[1]} empleados`;
  return `empresas de tamaño ${chip}`;
}

// Extrae el valor de un campo [Etiqueta] del texto del ICP serializado
function extractIcpField(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\[${escaped}\\]\\s*([\\s\\S]*?)(?=\\n\\[|\\n-{3,}|$)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

// Mapeo de país → código de región. El orden del array define prioridad de matching
// cuando un texto puede coincidir con múltiples entradas.
const COUNTRY_MAP: { re: RegExp; code: string }[] = [
  { re: /el salvador/,                              code: "SV" },
  { re: /costa rica/,                               code: "CR" },
  { re: /rep[uú]blica dominicana/,                  code: "DO" },
  { re: /chile/,                                    code: "CL" },
  { re: /m[eé]xico/,                               code: "MX" },
  { re: /per[uú]/,                                  code: "PE" },
  { re: /colombia/,                                 code: "CO" },
  { re: /argentina/,                                code: "AR" },
  { re: /ecuador/,                                  code: "EC" },
  { re: /guatemala/,                                code: "GT" },
  { re: /bolivia/,                                  code: "BO" },
  { re: /honduras/,                                 code: "HN" },
  { re: /panam[aá]/,                                code: "PA" },
  { re: /uruguay/,                                  code: "UY" },
  { re: /paraguay/,                                 code: "PY" },
  { re: /espa[nñ]a/,                               code: "ES" },
  { re: /brasil|brazil/,                            code: "BR" },
  { re: /estados unidos|united states|\busa?\b/,    code: "US" },
  { re: /latam|latinoam[eé]rica|am[eé]rica latina|centroam[eé]rica/, code: "LATAM" },
  { re: /global|mundial|worldwide/,                 code: "GLOBAL" },
];

// Construye la lista de regiones en el orden exacto en que aparecen en el texto de geografías.
function buildRegionsFromIcp(geoText: string): { value: string; label: string }[] {
  if (!geoText.trim()) return [];
  const found: { pos: number; opt: { value: string; label: string } }[] = [];
  for (const { re, code } of COUNTRY_MAP) {
    const match = re.exec(geoText.toLowerCase());
    if (!match) continue;
    const opt = ALL_REGIONS.find((r) => r.value === code);
    if (opt && !found.find((f) => f.opt.value === code)) {
      found.push({ pos: match.index, opt });
    }
  }
  found.sort((a, b) => a.pos - b.pos);
  return found.map((f) => f.opt);
}

// Extrae los chips de tamaño del ICP deserializado
function extractSizeOptsFromIcp(icpContent: string): string[] {
  const raw = deserializeIcpForm(icpContent).tamano_empresa ?? [];
  return raw;
}

export default function EmpresasPage() {
  const { currentClient, loading: clientLoading } = useClient();
  const [regions,         setRegions]         = useState<{ value: string; label: string }[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [sizeMode,   setSizeMode]   = useState("any");       // "any" | "custom" | chip value
  const [customMin,  setCustomMin]  = useState("");
  const [customMax,  setCustomMax]  = useState("");
  const [icpSizeOpts, setIcpSizeOpts] = useState<string[]>([]);
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
  const [lastRun, setLastRun] = useState<{ inserted: number; skipped: number } | null>(null);
  const [bulkPushing, setBulkPushing] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ pushed: number; total: number; errors: number } | null>(null);
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set());
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());

  // Modo de discovery
  const [discoveryMode, setDiscoveryMode] = useState<"recommend" | "search_one" | "import_csv">("recommend");

  // Buscar empresa individual
  const [searchName, setSearchName]           = useState("");
  const [searchLinkedin, setSearchLinkedin]   = useState("");
  const [searchingOne, setSearchingOne]       = useState(false);
  const [searchOneResult, setSearchOneResult] = useState<string | null>(null);

  // Importar CSV
  const [csvFile, setCsvFile]               = useState<File | null>(null);
  const [csvRows, setCsvRows]               = useState<Record<string, string>[]>([]);
  const [csvImporting, setCsvImporting]     = useState(false);
  const [csvProgress, setCsvProgress]       = useState(0);
  const [csvSummary, setCsvSummary]         = useState<{ ok: number; errors: number } | null>(null);

  // Aprobar todas las pendientes
  const [bulkApproving, setBulkApproving]   = useState(false);
  const [bulkApproveResult, setBulkApproveResult] = useState<{ approved: number } | null>(null);

  // ICP por industria
  const [icpMode,           setIcpMode]           = useState<"general" | "by_industry" | null>(null);
  const [industries,        setIndustries]        = useState<{ id: string; name: string }[]>([]);
  const [selectedIndustry,  setSelectedIndustry]  = useState<string>("");

  // Precarga regiones, tamaños e industrias desde el ICP activo del cliente
  useEffect(() => {
    if (!currentClient) return;
    setRegions([]);
    setSelectedRegions([]);
    setIcpSizeOpts([]);
    setSizeMode("any");
    setIcpMode(null);
    setIndustries([]);
    setSelectedIndustry("");

    Promise.all([
      fetch(`/api/clients/${currentClient.id}/context`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/clients/${currentClient.id}/icp-mode`, { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([ctxData, modeData]) => {
        const icp = (ctxData.items ?? []).find((i: { file_type: string; content?: string }) => i.file_type === "icp");
        if (icp?.content) {
          const parsed = deserializeIcpForm(icp.content);
          const builtRegions = buildRegionsFromIcp(parsed.geografias ?? "");
          if (builtRegions.length > 0) {
            setRegions(builtRegions);
            setSelectedRegions(builtRegions.map((r) => r.value));
          } else {
            setRegions(ALL_REGIONS);
            setSelectedRegions([]);
          }
          if (parsed.tamano_empresa?.length > 0) {
            setIcpSizeOpts(parsed.tamano_empresa);
            setSizeMode(parsed.tamano_empresa[0]);
          }
        } else {
          setRegions(ALL_REGIONS);
          setSelectedRegions([]);
        }

        const mode = modeData?.icp_mode ?? "general";
        setIcpMode(mode);

        if (mode === "by_industry") {
          fetch(`/api/clients/${currentClient.id}/industries`, { cache: "no-store" })
            .then((r) => r.json())
            .then((j) => {
              setIndustries(j.industries ?? []);
              if ((j.industries ?? []).length > 0) setSelectedIndustry(j.industries[0].id);
            });
        }
      })
      .catch(() => {
        setRegions(ALL_REGIONS);
        setSelectedRegions([]);
      });
  }, [currentClient?.id]);

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
    const clientParam = currentClient ? `&client_id=${currentClient.id}` : "";
    const res = await fetch(`/api/companies?status=${forStatus}${clientParam}`, { cache: "no-store" });
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
    if (!clientLoading) load();
  }, [tab, currentClient?.id, clientLoading]);

  async function discover() {
    setDiscovering(true);
    setError(null);
    setLastRun(null);

    let size_hint: string | null = null;
    if (sizeMode === "custom") {
      const min = customMin ? parseInt(customMin) : null;
      const max = customMax ? parseInt(customMax) : null;
      if (min && max) size_hint = `empresas con ${min} a ${max} empleados`;
      else if (min)   size_hint = `empresas con mínimo ${min} empleados`;
      else if (max)   size_hint = `empresas con máximo ${max} empleados`;
    } else if (sizeMode !== "any") {
      size_hint = chipToSizeHint(sizeMode);
    }

    const res = await fetch("/api/companies/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        region: selectedRegions.join(", ") || "LATAM",
        size_hint,
        limit,
        client_id: currentClient?.id ?? null,
        industry_id: icpMode === "by_industry" && selectedIndustry ? selectedIndustry : null,
      })
    });
    const data = await res.json();
    setDiscovering(false);
    if (!res.ok) {
      setError(data.error ?? "Discovery failed");
      return;
    }
    setLastRun({ inserted: data.inserted?.length ?? 0, skipped: data.skipped ?? 0 });
    setTab("pending");
    load("pending");
  }

  // Limpia selección al cambiar de tab
  useEffect(() => { setSelectedIds(new Set()); }, [tab]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function enrichSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setEnrichingIds(new Set(ids));
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/companies/${id}/deep-research`, { method: "POST" }).catch(() => {})
      )
    );
    setEnrichingIds(new Set());
    setSelectedIds(new Set());
    load(tab);
  }

  // Buscar una empresa por nombre
  async function searchOne() {
    if (!searchName.trim()) return;
    setSearchingOne(true);
    setSearchOneResult(null);
    const res = await fetch("/api/companies/research-one", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: searchName.trim(),
        linkedin_url: searchLinkedin.trim() || undefined,
        client_id: currentClient?.id ?? null
      })
    });
    const data = await res.json();
    setSearchingOne(false);
    if (!res.ok) {
      setSearchOneResult(`error:${data.error ?? "Error buscando empresa"}`);
    } else if (data.already_exists) {
      setSearchOneResult("exists:");
    } else {
      setSearchOneResult(`ok:${data.company?.company_name ?? searchName}`);
      load("pending");
    }
  }

  // Parsear CSV (columnas: name, linkedin_url, website, city, country)
  function parseCsv(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? "";
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) { setCsvRows([]); return; }
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_").replace(/['"]/g, ""));
      const rows = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
        return obj;
      }).filter((r) => r.name?.trim());
      setCsvRows(rows);
    };
    reader.readAsText(file);
  }

  async function importCsv() {
    if (csvRows.length === 0) return;
    setCsvImporting(true);
    setCsvProgress(0);
    setCsvSummary(null);
    let ok = 0;
    let errors = 0;
    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      try {
        const res = await fetch("/api/companies/research-one", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: row.name,
            linkedin_url: row.linkedin_url || undefined,
            website: row.website || undefined,
            city: row.city || undefined,
            country: row.country || undefined,
            client_id: currentClient?.id ?? null
          })
        });
        if (res.ok) ok++; else errors++;
      } catch { errors++; }
      setCsvProgress(i + 1);
    }
    setCsvImporting(false);
    setCsvSummary({ ok, errors });
    load("pending");
  }

  // Aprobar todas las pendientes en bloque
  async function bulkApprove() {
    setBulkApproving(true);
    setBulkApproveResult(null);
    const res = await fetch("/api/companies/bulk-approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: currentClient?.id ?? null })
    });
    const data = await res.json();
    setBulkApproving(false);
    if (res.ok) {
      setBulkApproveResult({ approved: data.approved ?? 0 });
      load("pending");
    }
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
      {!currentClient && (
        <div className="card flex items-center gap-3 border border-warning-bg bg-warning-bg/40 text-warning-fg text-sm">
          <IconAlertCircle size={16} className="shrink-0" />
          Selecciona un cliente en el sidebar para ver y gestionar sus empresas.
        </div>
      )}
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
          <IconSparkles size={18} className="text-brand" /> Agregar empresas
        </h2>

        {/* Tabs de modo */}
        <div className="flex gap-2 mb-4">
          {(
            [
              { key: "recommend",  label: "Recomendación IA",  icon: IconSparkles },
              { key: "search_one", label: "Buscar empresa",    icon: IconSearch   },
              { key: "import_csv", label: "Importar CSV",      icon: IconUpload   }
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setDiscoveryMode(key)}
              className={`btn text-xs ${
                discoveryMode === key
                  ? "bg-brand text-white"
                  : "bg-white border border-[#E5E2F0] text-ink hover:border-brand-soft"
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {/* Modo: Recomendación IA */}
        {discoveryMode === "recommend" && (
          <>
            <div className="space-y-3">
              {/* Selector de regiones — chips multi-select */}
              <div>
                <label className="label block mb-2">
                  Región
                  {selectedRegions.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-ink-muted">
                      ({selectedRegions.length} seleccionada{selectedRegions.length !== 1 ? "s" : ""})
                    </span>
                  )}
                </label>
                {regions.length === 0 ? (
                  <p className="text-xs text-ink-subtle italic">Cargando geografías del ICP…</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {regions.map((r) => {
                      const active = selectedRegions.includes(r.value);
                      return (
                        <button
                          key={r.value}
                          type="button"
                          onClick={() =>
                            setSelectedRegions((prev) =>
                              active ? prev.filter((v) => v !== r.value) : [...prev, r.value]
                            )
                          }
                          className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                            active
                              ? "text-white border-transparent"
                              : "bg-white border-border text-ink-muted hover:border-brand-soft"
                          }`}
                          style={active ? { background: "#251762", borderColor: "#251762" } : {}}
                        >
                          {r.label}
                        </button>
                      );
                    })}
                    {selectedRegions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedRegions([])}
                        className="px-3 py-1 rounded-full text-xs text-ink-subtle hover:text-ink border border-dashed border-border"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                )}
              </div>
            {/* Selector de industria — solo cuando el cliente usa ICP por industria */}
            {icpMode === "by_industry" && industries.length > 0 && (
              <div>
                <label className="label block mb-2">Industria</label>
                <div className="flex flex-wrap gap-2">
                  {industries.map((ind) => {
                    const active = selectedIndustry === ind.id;
                    return (
                      <button
                        key={ind.id}
                        type="button"
                        onClick={() => setSelectedIndustry(ind.id)}
                        className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                          active
                            ? "text-white border-transparent"
                            : "bg-white border-border text-ink-muted hover:border-brand-soft"
                        }`}
                        style={active ? { background: "#251762", borderColor: "#251762" } : {}}
                      >
                        {ind.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {icpMode === "by_industry" && industries.length === 0 && (
              <div className="text-xs text-warning-fg flex items-center gap-1.5">
                <IconAlertCircle size={13} />
                Este cliente no tiene industrias configuradas. Ve a SISTEMA → ICP para crearlas.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <Field label="Tamaño objetivo">
                <select
                  className="input"
                  value={sizeMode}
                  onChange={(e) => setSizeMode(e.target.value)}
                >
                  {icpSizeOpts.map((opt) => (
                    <option key={opt} value={opt}>{opt} empleados</option>
                  ))}
                  <option value="any">Cualquier tamaño</option>
                  <option value="custom">Rango personalizado…</option>
                </select>
                {sizeMode === "custom" && (
                  <div className="flex gap-2 mt-2">
                    <input
                      type="number"
                      min={1}
                      className="input flex-1"
                      placeholder="Mín. empleados"
                      value={customMin}
                      onChange={(e) => setCustomMin(e.target.value)}
                    />
                    <input
                      type="number"
                      min={1}
                      className="input flex-1"
                      placeholder="Máx. empleados"
                      value={customMax}
                      onChange={(e) => setCustomMax(e.target.value)}
                    />
                  </div>
                )}
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
          </>
        )}

        {/* Modo: Buscar empresa individual */}
        {discoveryMode === "search_one" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Nombre de la empresa">
                <input
                  className="input"
                  placeholder="Nombre de la empresa..."
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") searchOne(); }}
                />
              </Field>
              <Field label="LinkedIn URL (opcional)">
                <input
                  className="input"
                  placeholder="https://linkedin.com/company/..."
                  value={searchLinkedin}
                  onChange={(e) => setSearchLinkedin(e.target.value)}
                />
              </Field>
            </div>
            <button
              onClick={searchOne}
              disabled={searchingOne || !searchName.trim()}
              className="btn-primary"
            >
              {searchingOne ? (
                <><IconLoader2 size={15} className="animate-spin" /> Investigando…</>
              ) : (
                <><IconSearch size={15} /> Investigar empresa</>
              )}
            </button>
            {searchOneResult && (
              <div
                className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
                  searchOneResult.startsWith("ok:")
                    ? "bg-success-bg text-success-fg"
                    : searchOneResult.startsWith("exists:")
                    ? "bg-warning-bg text-warning-fg"
                    : "bg-danger-bg text-danger-fg"
                }`}
              >
                {searchOneResult.startsWith("ok:") && (
                  <><IconCheck size={14} /> ✓ {searchOneResult.slice(3)} agregada como pendiente</>
                )}
                {searchOneResult.startsWith("exists:") && (
                  <><IconAlertCircle size={14} /> Ya existe en la base</>
                )}
                {searchOneResult.startsWith("error:") && (
                  <><IconAlertCircle size={14} /> {searchOneResult.slice(6)}</>
                )}
              </div>
            )}
          </div>
        )}

        {/* Modo: Importar CSV */}
        {discoveryMode === "import_csv" && (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">
              CSV con columnas: <code className="bg-[#F4F2FB] px-1 rounded">name</code>,{" "}
              <code className="bg-[#F4F2FB] px-1 rounded">linkedin_url</code> (opcional),{" "}
              <code className="bg-[#F4F2FB] px-1 rounded">website</code> (opcional),{" "}
              <code className="bg-[#F4F2FB] px-1 rounded">city</code>,{" "}
              <code className="bg-[#F4F2FB] px-1 rounded">country</code>
            </p>
            <input
              type="file"
              accept=".csv"
              className="input"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setCsvFile(f);
                setCsvRows([]);
                setCsvSummary(null);
                setCsvProgress(0);
                if (f) parseCsv(f);
              }}
            />
            {csvRows.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-ink-muted">{csvRows.length} filas detectadas</div>
                <div className="rounded-lg border border-[#E5E2F0] overflow-hidden text-xs">
                  <table className="w-full">
                    <thead className="bg-[#F4F2FB]">
                      <tr>
                        {Object.keys(csvRows[0]).map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-medium text-ink-muted">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t border-[#E5E2F0]">
                          {Object.values(row).map((v, j) => (
                            <td key={j} className="px-3 py-2 text-ink/80 truncate max-w-[140px]">{v}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {csvRows.length > 5 && (
                    <div className="px-3 py-2 text-ink-muted bg-[#F9F8FD] border-t border-[#E5E2F0]">
                      +{csvRows.length - 5} filas más…
                    </div>
                  )}
                </div>
                <button
                  onClick={importCsv}
                  disabled={csvImporting}
                  className="btn-primary"
                >
                  {csvImporting ? (
                    <><IconLoader2 size={15} className="animate-spin" /> Importando {csvProgress}/{csvRows.length}…</>
                  ) : (
                    <><IconUpload size={15} /> Importar e investigar ({csvRows.length})</>
                  )}
                </button>
                {csvImporting && (
                  <div className="w-full bg-[#E5E2F0] rounded-full h-1.5">
                    <div
                      className="bg-brand h-1.5 rounded-full transition-all"
                      style={{ width: `${(csvProgress / csvRows.length) * 100}%` }}
                    />
                  </div>
                )}
                {csvSummary && (
                  <div className="flex items-center gap-2 text-sm bg-success-bg text-success-fg rounded-lg px-3 py-2">
                    <IconCheck size={14} />
                    {csvSummary.ok} empresas importadas
                    {csvSummary.errors > 0 && ` · ${csvSummary.errors} con error`}
                  </div>
                )}
              </div>
            )}
            {csvFile && csvRows.length === 0 && (
              <div className="text-sm text-danger-fg">No se encontraron filas válidas en el CSV.</div>
            )}
          </div>
        )}
      </section>

      <div className="flex items-center justify-between flex-wrap gap-2">
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
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <ScoreChip label="alto" color="success" count={counts.high ?? 0} />
          <ScoreChip label="medio" color="warning" count={counts.medium ?? 0} />
          <ScoreChip label="bajo" color="danger" count={counts.low ?? 0} />
          {/* Botón de investigación batch — solo en Pendientes cuando hay selección */}
          {tab === "pending" && selectedIds.size > 0 && (
            <button
              onClick={enrichSelected}
              disabled={enrichingIds.size > 0}
              className="btn-primary"
              style={{ background: "#251762" }}
              title="Investiga en profundidad las empresas seleccionadas con Perplexity + Claude"
            >
              {enrichingIds.size > 0 ? (
                <><IconLoader2 size={14} className="animate-spin" /> Investigando {enrichingIds.size}…</>
              ) : (
                <><IconMicroscope size={14} /> Investigar {selectedIds.size} seleccionada{selectedIds.size > 1 ? "s" : ""}</>
              )}
            </button>
          )}
          {tab === "pending" && statusCounts.pending > 0 && selectedIds.size === 0 && (
            <button
              onClick={bulkApprove}
              disabled={bulkApproving}
              className="btn-primary"
              style={{ background: "#251762" }}
              title="Aprueba todas las empresas pendientes del cliente actual"
            >
              {bulkApproving ? (
                <><IconLoader2 size={14} className="animate-spin" /> Aprobando…</>
              ) : (
                <><IconCheck size={14} /> Aprobar todas ({statusCounts.pending})</>
              )}
            </button>
          )}
          {tab === "approved" && unpushedCount > 0 && (
            <button
              onClick={pushAllToClay}
              disabled={bulkPushing}
              className="btn-primary"
              title="Empuja a Clay todas las aprobadas que aún no fueron prospectadas"
            >
              <IconRocket size={14} />
              {bulkPushing ? "Prospectando…" : `Prospectar todas en Clay (${unpushedCount})`}
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

      {bulkApproveResult && (
        <div className="card text-sm flex items-center gap-3">
          <IconCheck size={16} className="text-success-fg" />
          <span>{bulkApproveResult.approved} empresas aprobadas</span>
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
            <CompanyCard
              key={c.id}
              c={c}
              onChange={load}
              selected={tab === "pending" && selectedIds.has(c.id)}
              onToggleSelect={tab === "pending" ? () => toggleSelect(c.id) : undefined}
              externalEnriching={enrichingIds.has(c.id)}
            />
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

function CompanyCard({
  c,
  onChange,
  selected,
  onToggleSelect,
  externalEnriching
}: {
  c: Company;
  onChange: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  externalEnriching?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [pushingClay, setPushingClay] = useState(false);
  const [clayError, setClayError] = useState<string | null>(c.clay_push_error);
  const [clayPushedAt, setClayPushedAt] = useState<string | null>(c.clay_pushed_at);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [deepResearch, setDeepResearch] = useState<DeepResearch | null>(() => {
    if (!c.deep_research) return null;
    try { return JSON.parse(c.deep_research) as DeepResearch; } catch { return null; }
  });

  // Edición inline de tamaño de empresa
  const [editingSize, setEditingSize]   = useState(false);
  const [sizeValue, setSizeValue]       = useState(c.company_size?.toString() ?? "");
  const [companySize, setCompanySize]   = useState<number | null>(c.company_size);
  const [savingSize, setSavingSize]     = useState(false);

  // Re-verificar con IA
  const [reverifying, setReverifying]   = useState(false);
  const [reverifyFlash, setReverifyFlash] = useState(false);
  const [localCompany, setLocalCompany] = useState<Company>(c);

  const isEnriching = enriching || !!externalEnriching;

  async function enrichSelf(): Promise<void> {
    setEnriching(true);
    setEnrichError(null);
    try {
      const res  = await fetch(`/api/companies/${c.id}/deep-research`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setEnrichError(data.error ?? `Error ${res.status}`);
      } else if (data.result) {
        setDeepResearch(data.result as DeepResearch);
      } else {
        setEnrichError("La investigación no devolvió resultados. Intenta de nuevo.");
      }
    } catch (e: unknown) {
      setEnrichError(e instanceof Error ? e.message : "Error de red");
    }
    setEnriching(false);
  }

  async function saveSize() {
    const newSize = parseInt(sizeValue);
    if (isNaN(newSize) || newSize < 1) { setEditingSize(false); return; }
    setSavingSize(true);
    try {
      const res = await fetch(`/api/companies/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_size: newSize })
      });
      if (res.ok) {
        setCompanySize(newSize);
        setEditingSize(false);
      }
    } catch { /* silencia */ }
    setSavingSize(false);
  }

  async function reVerify() {
    setReverifying(true);
    try {
      const res  = await fetch(`/api/companies/${c.id}/re-verify`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.company) {
        setLocalCompany(data.company as Company);
        setReverifyFlash(true);
        setTimeout(() => setReverifyFlash(false), 2000);
      }
    } catch { /* silencia */ }
    setReverifying(false);
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
      if (decision === "approved" && !deepResearch) {
        // Auto-enrich en background — card desaparece de Pendientes inmediatamente
        enrichSelf().then(() => onChange());
        onChange();
      } else {
        onChange();
      }
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
    <div
      className="card flex flex-col gap-3 relative"
      style={selected ? { outline: "2px solid #62E0D8", outlineOffset: "1px" } : undefined}
    >
      {/* Overlay de enriquecimiento en progreso */}
      {isEnriching && (
        <div className="absolute inset-0 bg-white/80 rounded-xl flex flex-col items-center justify-center gap-2 z-10">
          <IconLoader2 size={24} className="animate-spin" style={{ color: "#251762" }} />
          <span className="text-sm font-medium" style={{ color: "#251762" }}>Investigando con IA…</span>
          <span className="text-xs text-ink-muted">Esto puede tardar 15–20 segundos</span>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-start gap-2.5">
          {/* Checkbox de selección — solo en Pendientes */}
          {onToggleSelect && (
            <button
              onClick={onToggleSelect}
              className="mt-0.5 shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors"
              style={{
                background:   selected ? "#251762" : "transparent",
                borderColor:  selected ? "#251762" : "#C4BFDB",
              }}
              title={selected ? "Deseleccionar" : "Seleccionar para investigar"}
            >
              {selected && <IconCheck size={10} color="white" />}
            </button>
          )}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold truncate">{c.company_name}</h3>
              {c.fit_score && (
                <span className={`badge ${scoreClass}`}>fit {c.fit_score}</span>
              )}
              {deepResearch && (
                <span className="badge" style={{ background: "rgba(98,224,216,0.15)", color: "#0E7A73", fontSize: "10px" }}>
                  ✦ enriquecida
                </span>
              )}
              {c.competitor_match && (
                <span className="badge bg-brand-tint text-brand">ya con {c.competitor_match}</span>
              )}
            </div>
            <div className="text-xs text-ink-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              {localCompany.company_type && localCompany.company_type !== "other" && <span>{labelType(localCompany.company_type)}</span>}
              {/* Tamaño editable inline */}
              {editingSize ? (
                <span className="flex items-center gap-1">
                  {localCompany.company_type !== "other" && companySize && <span>· </span>}
                  <input
                    autoFocus
                    type="number"
                    min={1}
                    className="w-20 border border-brand-soft rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-soft"
                    value={sizeValue}
                    onChange={(e) => setSizeValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveSize();
                      if (e.key === "Escape") setEditingSize(false);
                    }}
                  />
                  <button
                    onClick={saveSize}
                    disabled={savingSize}
                    className="text-success-fg hover:text-success-fg/80"
                    title="Guardar"
                  >
                    {savingSize ? <IconLoader2 size={11} className="animate-spin" /> : <IconCheck size={11} />}
                  </button>
                  <button
                    onClick={() => setEditingSize(false)}
                    className="text-ink-muted hover:text-danger-fg"
                    title="Cancelar"
                  >
                    <IconX size={11} />
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => { setEditingSize(true); setSizeValue(companySize?.toString() ?? ""); }}
                  className="inline-flex items-center gap-1 hover:text-ink group"
                  title="Editar número de empleados"
                >
                  {companySize ? (
                    <span>{localCompany.company_type !== "other" ? "· " : ""}{companySize} empleados</span>
                  ) : (
                    <span className="text-ink-subtle italic">N/A empleados</span>
                  )}
                  <IconPencil size={10} className="opacity-0 group-hover:opacity-60 transition-opacity" />
                </button>
              )}
              {(localCompany.company_city || localCompany.company_country) && (
                <span>· {[localCompany.company_city, localCompany.company_country].filter(Boolean).join(", ")}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {c.company_website && (
            <a href={c.company_website} target="_blank" rel="noreferrer" className="btn-secondary" title="Sitio web">
              <IconExternalLink size={14} />
            </a>
          )}
          {c.company_linkedin_url && (
            <a href={c.company_linkedin_url} target="_blank" rel="noreferrer" className="btn-secondary" title="LinkedIn">
              <IconBrandLinkedin size={14} />
            </a>
          )}
        </div>
      </div>

      {localCompany.fit_signals && (
        <div>
          <div className="label mb-1">Señales detectadas</div>
          <div className="text-sm">{localCompany.fit_signals}</div>
        </div>
      )}

      {(localCompany.cad_software || localCompany.scanner_technology) && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="label mb-1">CAD</div>
            <div>{localCompany.cad_software || <span className="text-ink-subtle">—</span>}</div>
          </div>
          <div>
            <div className="label mb-1">Escáner</div>
            <div>{localCompany.scanner_technology || <span className="text-ink-subtle">—</span>}</div>
          </div>
        </div>
      )}

      {localCompany.research_summary && (
        <div>
          <div className="label mb-1">Razonamiento IA</div>
          <p className="text-sm text-ink/90">{localCompany.research_summary}</p>
        </div>
      )}

      {localCompany.research_sources && localCompany.research_sources.length > 0 && !deepResearch && (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer hover:text-ink">
            Fuentes ({localCompany.research_sources.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {localCompany.research_sources.slice(0, 8).map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-brand truncate inline-block max-w-full">
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Bloque de investigación profunda */}
      {deepResearch ? (
        <div className="rounded-lg p-4 space-y-3 text-sm" style={{ background: "rgba(37,23,98,0.04)", border: "1px solid rgba(37,23,98,0.1)" }}>
          <div className="flex items-center gap-2 font-semibold text-xs uppercase tracking-wide" style={{ color: "#251762" }}>
            <IconMicroscope size={13} /> Investigación profunda
          </div>
          {deepResearch.trigger && (
            <div className="flex gap-2">
              <IconBolt size={14} className="shrink-0 mt-0.5" style={{ color: "#62E0D8" }} />
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-0.5">Trigger</div>
                <p className="text-ink/90 leading-snug">{deepResearch.trigger}</p>
              </div>
            </div>
          )}
          {deepResearch.angulo && (
            <div className="flex gap-2">
              <IconTarget size={14} className="shrink-0 mt-0.5" style={{ color: "#62E0D8" }} />
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-0.5">Ángulo de mensaje</div>
                <p className="text-ink/90 leading-snug">{deepResearch.angulo}</p>
              </div>
            </div>
          )}
          {deepResearch.senales && deepResearch.senales.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1.5">Señales específicas</div>
              <ul className="space-y-1">
                {deepResearch.senales.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-ink/90">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#62E0D8" }} />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {deepResearch.decisores && deepResearch.decisores.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1.5 flex items-center gap-1">
                <IconUser size={11} /> Decisores detectados
              </div>
              <div className="flex flex-wrap gap-1.5">
                {deepResearch.decisores.map((d, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#251762", color: "#fff" }}>
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
          {deepResearch.fuentes && deepResearch.fuentes.length > 0 && (
            <details className="text-xs text-ink-muted">
              <summary className="cursor-pointer hover:text-ink">Fuentes reales ({deepResearch.fuentes.length})</summary>
              <ul className="mt-2 space-y-1">
                {deepResearch.fuentes.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-brand truncate inline-block max-w-full">
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        /* Botón de enriquecimiento individual — cuando no hay deep_research */
        localCompany.status === "pending" && (
          <div className="flex flex-col gap-1">
            <button
              onClick={enrichSelf}
              disabled={isEnriching}
              className="btn-secondary text-xs self-start"
              title="Investiga esta empresa en profundidad antes de decidir"
            >
              <IconMicroscope size={13} /> Investigar en profundidad
            </button>
            {enrichError && (
              <div className="text-xs text-danger-fg flex items-center gap-1.5">
                <IconAlertCircle size={12} /> {enrichError}
              </div>
            )}
          </div>
        )
      )}

      {/* Botón Re-verificar con IA */}
      <div className="flex items-center gap-2">
        <button
          onClick={reVerify}
          disabled={reverifying}
          className="btn-secondary text-xs self-start"
          title="Re-investiga esta empresa con los prompts de producción y actualiza sus datos"
        >
          {reverifying ? (
            <IconLoader2 size={13} className="animate-spin" />
          ) : (
            <IconRefresh size={13} />
          )}
          Re-verificar con IA
        </button>
        {reverifyFlash && (
          <span className="text-xs text-success-fg flex items-center gap-1">
            <IconCheck size={12} /> Actualizado
          </span>
        )}
      </div>

      {localCompany.reject_reason && (
        <div className="text-xs text-danger-fg bg-danger-bg rounded-md p-2">
          Rechazada: {localCompany.reject_reason}
        </div>
      )}

      {localCompany.status === "approved" && (
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

      {localCompany.status === "pending" && (
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
