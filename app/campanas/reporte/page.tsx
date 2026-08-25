"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  IconMail,
  IconUsers,
  IconBuilding,
  IconTargetArrow,
  IconLoader2,
  IconAlertCircle,
  IconRefresh,
  IconArrowLeft,
  IconChevronUp,
  IconChevronDown,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";
import { RangeKey, RANGE_LABELS } from "@/lib/dashboardRanges";

// ─── Tipos ──────────────────────────────────────────────────────────────────

type CampaignRef = { id: string; name: string };

type LeadRow = {
  id: string;
  contact_id: string | null;
  email: string | null;
  first_name: string;
  last_name: string;
  company_name: string;
  job_title: string;
  added_at: string | null;
  campaign_id: string;
  campaign_name: string;
};

type Stats = {
  contactos: number;
  empresas: number;
  campanas_con_actividad: number;
  campanas_total: number;
};

type ApiResponse = {
  campaigns: CampaignRef[];
  leads: LeadRow[];
  stats: Stats;
  error?: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type SortKey = "added_at" | "name" | "company" | "job_title" | "campaign";
type SortDir = "asc" | "desc";

const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  added_at: "desc",
  name: "asc",
  company: "asc",
  job_title: "asc",
  campaign: "asc",
};

function sortValue(l: LeadRow, key: SortKey): string {
  switch (key) {
    case "added_at": return l.added_at ?? "";
    case "name": return `${l.first_name} ${l.last_name}`.trim() || l.email || "";
    case "company": return l.company_name;
    case "job_title": return l.job_title;
    case "campaign": return l.campaign_name;
  }
}

function SortableTh({
  label, sortKey, activeKey, dir, onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="px-3 py-2 text-left font-medium text-ink-muted whitespace-nowrap cursor-pointer select-none hover:text-ink"
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active ? (dir === "asc" ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />) : <IconChevronDown size={12} className="opacity-20" />}
      </span>
    </th>
  );
}

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub?: string }) {
  return (
    <div className="card py-3 px-4 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-ink-muted uppercase">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold" style={{ color: "#251762" }}>{value}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────────

export default function ReporteCampanasPage() {
  const { currentClient } = useClient();
  const [rangeKey, setRangeKey] = useState<RangeKey>("this_month");
  const [campaignFilter, setCampaignFilter] = useState<string>("");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("added_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function load(clientId: string) {
    setLoading(true);
    setError(null);
    fetch(`/api/lemlist/all-leads?client_id=${clientId}&range=${rangeKey}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ApiResponse) => {
        if (d.error) { setError(d.error); setData(null); return; }
        setData(d);
        setCampaignFilter("");
      })
      .catch((e) => setError(e.message ?? "Error de red"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (currentClient?.id && currentClient.id !== "__all__") load(currentClient.id);
    else setData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, rangeKey]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(SORT_DEFAULT_DIR[key]); }
  }

  const rows = useMemo(() => {
    const leads = data?.leads ?? [];
    const filtered = campaignFilter ? leads.filter((l) => l.campaign_id === campaignFilter) : leads;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => sortValue(a, sortKey).localeCompare(sortValue(b, sortKey)) * dir);
  }, [data, campaignFilter, sortKey, sortDir]);

  const campaignsPresent = useMemo(() => {
    const ids = new Set((data?.leads ?? []).map((l) => l.campaign_id));
    return (data?.campaigns ?? []).filter((c) => ids.has(c.id));
  }, [data]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/campanas" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink mb-1">
            <IconArrowLeft size={13} /> Volver a Campañas
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <IconMail size={24} />
            Reporte — todas las campañas
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Contactos que entraron a cualquier campaña de Lemlist de este cliente, no solo la campaña principal.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            className="input py-1.5 text-sm"
            value={rangeKey}
            onChange={(e) => setRangeKey(e.target.value as RangeKey)}
          >
            {Object.entries(RANGE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <button
            onClick={() => currentClient?.id && load(currentClient.id)}
            disabled={loading || !currentClient}
            className="btn-secondary"
            title="Refrescar"
          >
            {loading ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />}
          </button>
        </div>
      </header>

      {(!currentClient || currentClient.id === "__all__") && (
        <div className="card text-ink-muted text-sm">
          Selecciona un cliente específico en el sidebar (este reporte no soporta "Todos los clientes").
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
          <span>Consultando todas las campañas en Lemlist… puede tardar un minuto.</span>
        </div>
      )}

      {!loading && data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <KpiCard icon={<IconUsers size={13} />} label="Contactos" value={data.stats.contactos} />
            <KpiCard icon={<IconBuilding size={13} />} label="Empresas" value={data.stats.empresas} />
            <KpiCard
              icon={<IconTargetArrow size={13} />}
              label="Campañas con actividad"
              value={data.stats.campanas_con_actividad}
              sub={`de ${data.stats.campanas_total} campañas en total`}
            />
          </div>

          <section className="card space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-semibold flex items-center gap-2">
                <IconMail size={16} className="text-brand" /> Contactos
                <span className="text-xs font-normal text-ink-muted">({rows.length})</span>
              </h2>
              <div className="flex items-center gap-2 flex-wrap px-2.5 py-1.5 rounded-lg bg-[#F4F2FB]">
                <select
                  className="input w-auto min-w-0 py-1 px-2 text-xs"
                  value={campaignFilter}
                  onChange={(e) => setCampaignFilter(e.target.value)}
                >
                  <option value="">Todas las campañas</option>
                  {campaignsPresent.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="text-sm text-ink-muted py-6 text-center">Sin contactos para este filtro.</p>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead className="bg-[#F4F2FB]">
                    <tr>
                      <SortableTh label="Fecha de ingreso" sortKey="added_at" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="Contacto" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="Cargo" sortKey="job_title" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="Empresa" sortKey="company" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="Campaña" sortKey="campaign" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l) => (
                      <tr key={`${l.campaign_id}-${l.id}`} className="border-t border-[#E5E2F0]">
                        <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{formatDate(l.added_at)}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium">
                            {[l.first_name, l.last_name].filter(Boolean).join(" ") || "Sin identificar"}
                          </div>
                          <div className="text-xs text-ink-subtle">{l.email ?? "—"}</div>
                        </td>
                        <td className="px-3 py-2 text-ink-muted">{l.job_title || "—"}</td>
                        <td className="px-3 py-2 text-ink-muted">{l.company_name || "—"}</td>
                        <td className="px-3 py-2 text-ink-muted">{l.campaign_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
