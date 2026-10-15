"use client";

import { useEffect, useState, useMemo } from "react";
import {
  IconBulb,
  IconLoader2,
  IconAlertCircle,
  IconRefresh,
  IconCalendarEvent,
  IconCheck,
  IconPhoneCall,
  IconFilter,
  IconX,
  IconSearch,
  IconUsers,
} from "@tabler/icons-react";

// ─── Tipos ──────────────────────────────────────────────────────────────────

type CallSignalCategory =
  | "ciclo_presupuesto"
  | "evaluacion_proveedores"
  | "contrato_vigente"
  | "licitacion_compras"
  | "proyecto_postergado"
  | "necesidad_futura"
  | "cambio_organizacional"
  | "rechazo_definitivo";

type Relevancia = "alta" | "media" | "baja";

type CompanySignal = {
  id: string;
  categoria: CallSignalCategory;
  evidencia: string;
  tipo_senal: string;
  periodo: string;
  certeza: "explicito" | "inferido" | "insuficiente";
  relevancia: Relevancia;
  relevancia_motivo: string;
  call_date: string | null;
  client_id: string;
  client_name: string;
  reviewed: boolean;
};

type Vendor = { nombre: string; tipo: string };
type Contact = { name: string | null; job_title: string | null; contact_number: string | null };
type ClientInvolved = { client_id: string; client_name: string };

type CompanyGroup = {
  company_key: string;
  company_name: string;
  industry: string | null;
  top_relevance: Relevancia;
  call_count: number;
  pending_count: number;
  technologies: string[];
  vendors: Vendor[];
  contacts: Contact[];
  clients_involved: ClientInvolved[];
  signals: CompanySignal[];
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const RELEVANCE_META: Record<Relevancia, { label: string; bg: string; border: string; text: string }> = {
  alta: { label: "Alta", bg: "#fef2f2", border: "#fca5a5", text: "#dc2626" },
  media: { label: "Media", bg: "#fffbeb", border: "#fcd34d", text: "#d97706" },
  baja: { label: "Baja", bg: "#f9fafb", border: "#d1d5db", text: "#6b7280" },
};

const CATEGORY_LABELS: Record<CallSignalCategory, string> = {
  ciclo_presupuesto: "Ciclo de presupuesto",
  evaluacion_proveedores: "Evaluación de proveedores",
  contrato_vigente: "Contrato vigente / renovación",
  licitacion_compras: "Licitación / proceso de compras",
  proyecto_postergado: "Proyecto postergado",
  necesidad_futura: "Necesidad futura",
  cambio_organizacional: "Cambio organizacional",
  rechazo_definitivo: "Rechazo definitivo",
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS) as [CallSignalCategory, string][];

const TIPO_SENAL_LABEL: Record<string, string> = {
  restriccion_temporal: "Restricción temporal",
  oportunidad_futura: "Oportunidad futura",
  proceso_compra: "Proceso de compra",
  rechazo_definitivo: "Rechazo definitivo",
  informacion_contextual: "Información contextual",
};

const VENDOR_TIPO_LABEL: Record<string, string> = {
  competidor: "Competidor",
  proveedor_actual: "Proveedor actual",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  next.has(value) ? next.delete(value) : next.add(value);
  return next;
}

// ─── Página ─────────────────────────────────────────────────────────────────

export default function SenalesComercialesPage() {
  const [companies, setCompanies] = useState<CompanyGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<Set<CallSignalCategory>>(new Set());
  const [industryFilter, setIndustryFilter] = useState<Set<string>>(new Set());
  const [techFilter, setTechFilter] = useState<Set<string>>(new Set());
  const [vendorFilter, setVendorFilter] = useState<Set<string>>(new Set());

  function load() {
    setLoading(true);
    setError(null);
    fetch("/api/sdr/company-signals", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); setCompanies([]); return; }
        setCompanies(d.companies ?? []);
      })
      .catch((e) => setError(e.message ?? "Error de red"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function markCompanyReviewed(company: CompanyGroup) {
    const ids = Array.from(new Set(company.signals.map((s) => s.id)));
    setCompanies((prev) =>
      prev.map((c) => (c.company_key === company.company_key ? { ...c, pending_count: 0, signals: c.signals.map((s) => ({ ...s, reviewed: true })) } : c))
    );
    await fetch("/api/sdr/company-signals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal_ids: ids, reviewed: true }),
    }).catch(() => {});
  }

  const facets = useMemo(() => {
    const categories = new Set<CallSignalCategory>();
    const industries = new Set<string>();
    const techs = new Set<string>();
    const vendors = new Set<string>();
    for (const c of companies) {
      if (c.industry) industries.add(c.industry);
      for (const t of c.technologies) techs.add(t);
      for (const v of c.vendors) vendors.add(v.nombre);
      for (const s of c.signals) categories.add(s.categoria);
    }
    return {
      categories,
      industries: Array.from(industries).sort(),
      techs: Array.from(techs).sort(),
      vendors: Array.from(vendors).sort(),
    };
  }, [companies]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies.filter((c) => {
      if (q && !c.company_name.toLowerCase().includes(q)) return false;
      if (onlyPending && c.pending_count === 0) return false;
      if (categoryFilter.size > 0 && !c.signals.some((s) => categoryFilter.has(s.categoria))) return false;
      if (industryFilter.size > 0 && (!c.industry || !industryFilter.has(c.industry))) return false;
      if (techFilter.size > 0 && !c.technologies.some((t) => techFilter.has(t))) return false;
      if (vendorFilter.size > 0 && !c.vendors.some((v) => vendorFilter.has(v.nombre))) return false;
      return true;
    });
  }, [companies, search, onlyPending, categoryFilter, industryFilter, techFilter, vendorFilter]);

  const hasActiveFilters =
    categoryFilter.size > 0 || industryFilter.size > 0 || techFilter.size > 0 || vendorFilter.size > 0 || onlyPending || search.trim() !== "";

  function clearFilters() {
    setSearch("");
    setOnlyPending(false);
    setCategoryFilter(new Set());
    setIndustryFilter(new Set());
    setTechFilter(new Set());
    setVendorFilter(new Set());
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label">SDR</div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconBulb size={22} style={{ color: "#62E0D8" }} /> Señales comerciales
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Base de empresas con señales de valor detectadas por IA en llamadas de Allo — tecnología que usan, proveedores actuales, fechas de presupuesto. Agrupado por empresa, de todos los clientes, para reusar la señal con quien le calce.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-secondary shrink-0" title="Refrescar">
          {loading ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />}
        </button>
      </header>

      {!loading && companies.length > 0 && (
        <div className="card p-3 space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar empresa…"
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-[#E5E2F0] rounded-lg outline-none focus:border-[#62E0D8] bg-white"
              />
            </div>
            <button
              onClick={() => setOnlyPending((v) => !v)}
              className="text-xs px-2.5 py-1.5 rounded-full border transition"
              style={onlyPending ? { background: "#251762", color: "white", borderColor: "#251762" } : { background: "white", color: "#6B6884", borderColor: "#E5E2F0" }}
            >
              Solo con pendientes
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
            <IconFilter size={13} /> Tipo de señal
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_OPTIONS.filter(([value]) => facets.categories.has(value)).map(([value, label]) => {
              const active = categoryFilter.has(value);
              return (
                <button
                  key={value}
                  onClick={() => setCategoryFilter((prev) => toggleInSet(prev, value))}
                  className="text-xs px-2.5 py-1 rounded-full border transition"
                  style={active ? { background: "#251762", color: "white", borderColor: "#251762" } : { background: "white", color: "#6B6884", borderColor: "#E5E2F0" }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {facets.industries.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted pt-1">
                <IconFilter size={13} /> Industria
              </div>
              <div className="flex flex-wrap gap-1.5">
                {facets.industries.map((ind) => {
                  const active = industryFilter.has(ind);
                  return (
                    <button
                      key={ind}
                      onClick={() => setIndustryFilter((prev) => toggleInSet(prev, ind))}
                      className="text-xs px-2.5 py-1 rounded-full border transition"
                      style={active ? { background: "#251762", color: "white", borderColor: "#251762" } : { background: "white", color: "#6B6884", borderColor: "#E5E2F0" }}
                    >
                      {ind}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {facets.techs.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted pt-1">
                <IconFilter size={13} /> Tecnología que usan
              </div>
              <div className="flex flex-wrap gap-1.5">
                {facets.techs.map((t) => {
                  const active = techFilter.has(t);
                  return (
                    <button
                      key={t}
                      onClick={() => setTechFilter((prev) => toggleInSet(prev, t))}
                      className="text-xs px-2.5 py-1 rounded-full border transition"
                      style={active ? { background: "#6D28D9", color: "white", borderColor: "#6D28D9" } : { background: "white", color: "#6B6884", borderColor: "#E5E2F0" }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {facets.vendors.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted pt-1">
                <IconFilter size={13} /> Proveedor / competidor mencionado
              </div>
              <div className="flex flex-wrap gap-1.5">
                {facets.vendors.map((v) => {
                  const active = vendorFilter.has(v);
                  return (
                    <button
                      key={v}
                      onClick={() => setVendorFilter((prev) => toggleInSet(prev, v))}
                      className="text-xs px-2.5 py-1 rounded-full border transition"
                      style={active ? { background: "#1D4ED8", color: "white", borderColor: "#1D4ED8" } : { background: "white", color: "#6B6884", borderColor: "#E5E2F0" }}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {hasActiveFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink pt-1">
              <IconX size={12} /> Limpiar filtros
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="card border border-danger-bg text-danger-fg flex items-center gap-2 text-sm">
          <IconAlertCircle size={16} /> {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-ink-muted py-10 justify-center">
          <IconLoader2 size={22} className="animate-spin" />
          <span>Cargando señales…</span>
        </div>
      )}

      {!loading && !error && companies.length === 0 && (
        <div className="card text-center py-12 text-ink-muted text-sm">
          Todavía no hay empresas con señales analizadas — se generan automáticamente a partir de las llamadas conectadas de Allo de todos los clientes.
        </div>
      )}

      {!loading && companies.length > 0 && filtered.length === 0 && (
        <div className="card text-center py-12 text-ink-muted text-sm">Sin resultados para estos filtros.</div>
      )}

      <div className="space-y-3">
        {filtered.map((c) => {
          const relevance = RELEVANCE_META[c.top_relevance];
          return (
            <div key={c.company_key} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink text-base">{c.company_name}</span>
                    {c.industry && <span className="text-xs px-2 py-0.5 rounded-full bg-[#F1EEF7] text-[#251762]">{c.industry}</span>}
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full border"
                      style={{ background: relevance.bg, borderColor: relevance.border, color: relevance.text }}
                    >
                      Relevancia {relevance.label}
                    </span>
                    {c.pending_count > 0 && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E]">
                        {c.pending_count} sin revisar
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-ink-muted flex-wrap">
                    <span>{c.call_count} llamada{c.call_count !== 1 ? "s" : ""}</span>
                    <span className="flex items-center gap-1">
                      <IconUsers size={12} /> Descubierta vía: {c.clients_involved.map((cl) => cl.client_name).join(", ")}
                    </span>
                  </div>
                </div>
                {c.pending_count > 0 && (
                  <button
                    onClick={() => markCompanyReviewed(c)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#E5E2F0] hover:bg-gray-50 transition shrink-0"
                  >
                    <IconCheck size={13} /> Marcar todas revisadas
                  </button>
                )}
              </div>

              {c.technologies.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-ink-muted">Tecnología que usan:</span>
                  {c.technologies.map((t, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-[#F5F3FF] text-[#6D28D9]">{t}</span>
                  ))}
                </div>
              )}

              {c.vendors.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-ink-muted">Proveedores / competidores:</span>
                  {c.vendors.map((v, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#1D4ED8]">
                      {v.nombre} · {VENDOR_TIPO_LABEL[v.tipo] ?? v.tipo}
                    </span>
                  ))}
                </div>
              )}

              {c.contacts.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-ink-muted">Contactos conocidos:</span>
                  {c.contacts.map((ct, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-[#F9F8FC] text-ink-muted border border-[#E5E2F0]">
                      {ct.name || "Sin nombre"}{ct.job_title ? ` · ${ct.job_title}` : ""}
                    </span>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {c.signals.map((sig, i) => (
                  <div key={`${sig.id}-${i}`} className="bg-[#F9F8FC] rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1.5 flex-wrap text-xs mb-1">
                      <span className="font-semibold text-ink">{CATEGORY_LABELS[sig.categoria] ?? sig.categoria}</span>
                      <span className="px-1.5 py-0.5 rounded bg-white border border-[#E5E2F0] text-ink-muted">
                        {TIPO_SENAL_LABEL[sig.tipo_senal] ?? sig.tipo_senal}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-white border border-[#E5E2F0] text-ink-muted capitalize">{sig.certeza}</span>
                      {sig.periodo && (
                        <span className="px-1.5 py-0.5 rounded bg-white border border-[#E5E2F0] text-ink-muted flex items-center gap-1">
                          <IconCalendarEvent size={11} /> {sig.periodo}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-ink italic">"{sig.evidencia}"</p>
                    <p className="text-xs text-ink-subtle mt-0.5">{sig.relevancia_motivo}</p>
                    <div className="flex items-center gap-1 text-[11px] text-ink-subtle mt-1">
                      <IconPhoneCall size={10} /> {formatDate(sig.call_date)} · {sig.client_name}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
