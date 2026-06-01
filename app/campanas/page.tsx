"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconMail,
  IconBrandLinkedin,
  IconSearch,
  IconRefresh,
  IconSend,
  IconLoader2,
  IconAlertCircle,
  IconPlayerPause,
  IconPlayerPlay,
  IconExternalLink,
  IconCheck,
  IconX,
  IconFilter,
  IconFileSpreadsheet,
  IconBrandHubspot,
} from "@tabler/icons-react";
import Link from "next/link";

// ─── Tipos ───────────────────────────────────────────────────────────────────

type CampaignStats = {
  total: number;
  contacted: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
};

type Campaign = {
  _id: string;
  name: string;
  isStarted: boolean;
};

type LeadState = "active" | "paused" | "replied" | "bounced" | "unsubscribed" | "finished";

type Lead = {
  _id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  jobTitle?: string;
  linkedinUrl?: string;
  isPaused: boolean;
  isFinished: boolean;
  completed?: string | null;
  addedAt?: string;
};

type PendingContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  company_name?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveLeadState(lead: Lead): LeadState {
  if (lead.isPaused) return "paused";
  if (lead.completed === "emailReplied" || lead.completed === "linkedinReplied") return "replied";
  if (lead.completed === "emailBounced") return "bounced";
  if (lead.completed === "emailUnsubscribed") return "unsubscribed";
  if (lead.isFinished) return "finished";
  return "active";
}

function fullName(lead: Lead): string {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email || "—";
}

function pct(num: number, den: number): string {
  if (!den) return "0%";
  return `${Math.round((num / den) * 100)}%`;
}

function relativeDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Math.round((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return "hoy";
  if (diff === 1) return "ayer";
  if (diff < 30) return `hace ${diff} días`;
  return d.toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function StatChip({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="card py-3 px-4 text-center min-w-[110px]">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="text-2xl font-bold mt-0.5" style={{ color: color ?? "#1a1040" }}>{value}</div>
      {sub && <div className="text-[11px] text-ink-muted mt-0.5">{sub}</div>}
    </div>
  );
}

const STATE_CONFIG: Record<LeadState, { label: string; bg: string; color: string }> = {
  active:       { label: "Activo",        bg: "#EDF9F8", color: "#0F6E56" },
  paused:       { label: "Pausado",       bg: "#FEF3C7", color: "#92400E" },
  replied:      { label: "Respondió",     bg: "#DCFCE7", color: "#166534" },
  bounced:      { label: "Rebotado",      bg: "#FEE2E2", color: "#991B1B" },
  unsubscribed: { label: "Desuscripto",   bg: "#F3F4F6", color: "#6B7280" },
  finished:     { label: "Terminado",     bg: "#F3F4F6", color: "#374151" },
};

function StateBadge({ state }: { state: LeadState }) {
  const c = STATE_CONFIG[state];
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: c.bg, color: c.color }}>
      {c.label}
    </span>
  );
}

function LeadCard({
  lead,
  campaignId,
  onPauseToggle,
}: {
  lead: Lead;
  campaignId: string;
  onPauseToggle: (email: string, pause: boolean) => void;
}) {
  const [toggling, setToggling] = useState(false);
  const state = deriveLeadState(lead);
  const name = fullName(lead);
  const initials = [lead.firstName?.[0], lead.lastName?.[0]].filter(Boolean).join("").toUpperCase() || "?";

  async function handlePause() {
    setToggling(true);
    await onPauseToggle(lead.email, !lead.isPaused);
    setToggling(false);
  }

  const hasLinkedin = Boolean(lead.linkedinUrl);

  return (
    <div className="card px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition">
      {/* Avatar */}
      <div
        className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
        style={{ background: "#251762" }}
      >
        {initials}
      </div>

      {/* Info principal */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-ink text-sm">{name}</span>
          {lead.companyName && <span className="text-ink-muted text-sm">· {lead.companyName}</span>}
          <StateBadge state={state} />
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          {lead.jobTitle && (
            <span className="text-xs text-ink-muted">{lead.jobTitle}</span>
          )}
          {/* Canales */}
          <div className="flex items-center gap-1.5">
            <span
              className="flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded"
              style={{ background: "#F0F4FF", color: "#4B5563" }}
            >
              <IconMail size={10} /> Email
            </span>
            {hasLinkedin && (
              <span
                className="flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded"
                style={{ background: "#EFF6FF", color: "#1D4ED8" }}
              >
                <IconBrandLinkedin size={10} /> LinkedIn
              </span>
            )}
          </div>
          {lead.addedAt && (
            <span className="text-[11px] text-ink-muted">{relativeDate(lead.addedAt)}</span>
          )}
        </div>
      </div>

      {/* Email */}
      {lead.email && (
        <span className="text-xs text-ink-muted hidden md:block max-w-[180px] truncate">{lead.email}</span>
      )}

      {/* Acciones */}
      <div className="flex items-center gap-2 shrink-0">
        {/* LinkedIn externo */}
        {lead.linkedinUrl && (
          <a
            href={lead.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded hover:bg-blue-50 transition"
            title="Ver en LinkedIn"
            style={{ color: "#1D4ED8" }}
          >
            <IconBrandLinkedin size={15} />
          </a>
        )}
        {/* Ver en Lemlist */}
        <a
          href={`https://app.lemlist.com/campaigns/${campaignId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded hover:bg-gray-100 transition text-ink-muted"
          title="Ver en Lemlist"
        >
          <IconExternalLink size={14} />
        </a>
        {/* Pausar / Reanudar */}
        {state !== "replied" && state !== "bounced" && state !== "unsubscribed" && state !== "finished" && (
          <button
            onClick={handlePause}
            disabled={toggling}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition disabled:opacity-50"
            style={
              lead.isPaused
                ? { borderColor: "#62E0D8", color: "#0F6E56", background: "#EDF9F8" }
                : { borderColor: "#E5E2F0", color: "#6B6884", background: "white" }
            }
            title={lead.isPaused ? "Reanudar campaña" : "Pausar campaña"}
          >
            {toggling ? (
              <IconLoader2 size={13} className="animate-spin" />
            ) : lead.isPaused ? (
              <IconPlayerPlay size={13} />
            ) : (
              <IconPlayerPause size={13} />
            )}
            {lead.isPaused ? "Reanudar" : "Pausar"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

type FilterState = "all" | "active" | "paused" | "replied" | "bounced" | "finished";

const FILTER_LABELS: Record<FilterState, string> = {
  all:      "Todos",
  active:   "Activos",
  paused:   "Pausados",
  replied:  "Respondieron",
  bounced:  "Rebotados",
  finished: "Terminados",
};

export default function CampanasPage() {
  const { currentClient } = useClient();

  const [campaign, setCampaign]     = useState<Campaign | null>(null);
  const [stats, setStats]           = useState<CampaignStats | null>(null);
  const [leads, setLeads]           = useState<Lead[]>([]);
  const [pending, setPending]       = useState<PendingContact[]>([]);
  const [tab, setTab]               = useState<"campaign" | "pending">("campaign");
  const [filter, setFilter]         = useState<FilterState>("all");
  const [search, setSearch]         = useState("");
  const [loading, setLoading]       = useState(false);
  const [pushing, setPushing]       = useState(false);
  const [pushResult, setPushResult] = useState<{ pushed: number; skipped: number } | null>(null);
  const [syncing, setSyncing]       = useState(false);
  const [syncResult, setSyncResult] = useState<{ updated: number; synced: number } | null>(null);
  const [error, setError]           = useState<string | null>(null);

  // ── Carga datos de campaña ──
  const loadCampaign = useCallback(async () => {
    if (!currentClient?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [statsRes, leadsRes, pendingRes] = await Promise.all([
        fetch(`/api/lemlist/campaigns?client_id=${currentClient.id}`),
        fetch(`/api/lemlist/campaigns/leads?client_id=${currentClient.id}`),
        fetch(`/api/contacts?client_id=${currentClient.id}&bucket=approved_pending`),
      ]);

      if (statsRes.ok) {
        const d = await statsRes.json();
        setCampaign(d.campaign);
        setStats(d.stats);
      } else {
        const d = await statsRes.json();
        setError(d.error ?? "Error cargando campaña");
      }

      if (leadsRes.ok) {
        const d = await leadsRes.json();
        setLeads(d.leads ?? []);
      }

      if (pendingRes.ok) {
        const d = await pendingRes.json();
        setPending(d.contacts ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [currentClient?.id]);

  useEffect(() => { loadCampaign(); }, [loadCampaign]);

  // ── Enviar a Lemlist ──
  async function pushAll() {
    if (!currentClient?.id) return;
    setPushing(true);
    setPushResult(null);
    const res = await fetch("/api/lemlist/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: currentClient.id }),
    });
    const d = await res.json();
    setPushResult({ pushed: d.pushed ?? 0, skipped: d.skipped ?? 0 });
    setPushing(false);
    loadCampaign();
  }

  // ── Sincronizar con HubSpot ──
  async function syncHubSpot() {
    if (!currentClient?.id) return;
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch("/api/lemlist/refresh-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: currentClient.id }),
    });
    const d = await res.json();
    setSyncResult({ updated: d.updated ?? 0, synced: d.synced ?? 0 });
    setSyncing(false);
  }

  // ── Pausar/reanudar lead ──
  async function handlePauseToggle(email: string, pause: boolean) {
    if (!currentClient?.id) return;
    await fetch("/api/lemlist/leads/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: currentClient.id, email, pause }),
    });
    setLeads((prev) =>
      prev.map((l) => (l.email === email ? { ...l, isPaused: pause } : l))
    );
  }

  // ── Filtrar y buscar leads ──
  const filteredLeads = useMemo(() => {
    let result = leads;

    if (filter !== "all") {
      result = result.filter((l) => {
        const state = deriveLeadState(l);
        if (filter === "finished") return state === "finished" || state === "unsubscribed";
        return state === filter;
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          fullName(l).toLowerCase().includes(q) ||
          l.email?.toLowerCase().includes(q) ||
          l.companyName?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [leads, filter, search]);

  // ── Contadores ──
  const counts = useMemo(() => ({
    active:   leads.filter((l) => deriveLeadState(l) === "active").length,
    paused:   leads.filter((l) => deriveLeadState(l) === "paused").length,
    replied:  leads.filter((l) => deriveLeadState(l) === "replied").length,
    bounced:  leads.filter((l) => deriveLeadState(l) === "bounced").length,
    finished: leads.filter((l) => ["finished", "unsubscribed"].includes(deriveLeadState(l))).length,
  }), [leads]);

  // ── Sin cliente ──
  if (!currentClient) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-ink-muted">Selecciona un cliente en el sidebar para ver sus campañas.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="label">Outreach</div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconMail size={22} style={{ color: "#62E0D8" }} /> Campañas
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Outreach multicanal (email + LinkedIn) vía Lemlist
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/campanas/subir"
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-[#E5E2F0] hover:bg-gray-50 transition"
          >
            <IconFileSpreadsheet size={14} style={{ color: "#62E0D8" }} />
            Carga masiva
          </Link>
          <button
            onClick={syncHubSpot}
            disabled={syncing}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-[#E5E2F0] hover:bg-gray-50 transition"
            title="Sincronizar contactos con HubSpot"
          >
            {syncing
              ? <IconLoader2 size={14} className="animate-spin" />
              : <IconBrandHubspot size={14} style={{ color: "#FF7A59" }} />
            }
            {syncing ? "Sincronizando…" : "Sync HubSpot"}
          </button>
          <button
            onClick={loadCampaign}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-[#E5E2F0] hover:bg-gray-50 transition"
          >
            <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
            Refrescar
          </button>
          {pending.length > 0 && (
            <button
              onClick={pushAll}
              disabled={pushing}
              className="btn-primary flex items-center gap-1.5 text-sm"
            >
              {pushing ? <IconLoader2 size={14} className="animate-spin" /> : <IconSend size={14} />}
              Enviar {pending.length} a Lemlist
            </button>
          )}
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="card border-l-4 border-red-400 px-4 py-3 flex items-center gap-2 text-red-700">
          <IconAlertCircle size={16} />
          <span className="text-sm">{error}</span>
          {error.includes("Config. cliente") && (
            <a href="/configuracion/cliente" className="underline ml-1 text-sm">Configurar →</a>
          )}
        </div>
      )}

      {/* Sync HubSpot result */}
      {syncResult && (
        <div className="card border-l-4 px-4 py-3 flex items-center gap-2"
          style={{ borderColor: "#FF7A59", color: "#7D4A35" }}
        >
          <IconBrandHubspot size={16} style={{ color: "#FF7A59" }} />
          <span className="text-sm font-medium">
            HubSpot sincronizado: {syncResult.synced} contacto{syncResult.synced !== 1 ? "s" : ""} creados/actualizados
            {syncResult.updated > 0 && ` · ${syncResult.updated} enriquecidos con email/teléfono de Lemlist`}
          </span>
        </div>
      )}

      {/* Push result */}
      {pushResult && (
        <div className="card border-l-4 px-4 py-3 flex items-center gap-2"
          style={{ borderColor: "#62E0D8", color: "#0F6E56" }}
        >
          <IconCheck size={16} />
          <span className="text-sm font-medium">
            {pushResult.pushed} contactos enviados a Lemlist
            {pushResult.skipped > 0 && ` · ${pushResult.skipped} saltados (sin email)`}
          </span>
        </div>
      )}

      {/* Campaign header card */}
      {campaign && (
        <div className="card px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconMail size={16} style={{ color: "#62E0D8" }} />
              <span className="font-semibold text-ink">{campaign.name}</span>
              <span
                className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                style={
                  campaign.isStarted
                    ? { background: "#DCFCE7", color: "#166534" }
                    : { background: "#FEF3C7", color: "#92400E" }
                }
              >
                {campaign.isStarted ? "Activa" : "Pausada"}
              </span>
            </div>
            <a
              href={`https://app.lemlist.com/campaigns/${campaign._id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-ink-muted flex items-center gap-1 hover:underline"
            >
              Ver en Lemlist <IconExternalLink size={12} />
            </a>
          </div>

          {/* Stats */}
          {stats && (
            <div className="flex flex-wrap gap-3 mt-4">
              <StatChip label="En campaña" value={stats.contacted || leads.length} />
              <StatChip
                label="Abiertos"
                value={pct(stats.opened, stats.contacted)}
                sub={`${stats.opened} de ${stats.contacted}`}
                color={stats.opened > 0 ? "#1D4ED8" : undefined}
              />
              <StatChip
                label="Clicks"
                value={pct(stats.clicked, stats.contacted)}
                sub={`${stats.clicked} clicks`}
                color={stats.clicked > 0 ? "#0F6E56" : undefined}
              />
              <StatChip
                label="Replies"
                value={pct(stats.replied, stats.contacted)}
                sub={`${stats.replied} respuestas`}
                color={stats.replied > 0 ? "#166534" : undefined}
              />
              <StatChip
                label="Rebotados"
                value={stats.bounced}
                color={stats.bounced > 0 ? "#991B1B" : undefined}
              />
              {counts.paused > 0 && (
                <StatChip label="Pausados" value={counts.paused} color="#92400E" />
              )}
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-ink-muted gap-2">
          <IconLoader2 size={18} className="animate-spin" />
          <span className="text-sm">Cargando campañas…</span>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 border-b border-[#E5E2F0]">
            {(["campaign", "pending"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="px-4 py-2.5 text-sm font-medium border-b-2 transition"
                style={
                  tab === t
                    ? { borderColor: "#62E0D8", color: "#62E0D8" }
                    : { borderColor: "transparent", color: "#6B6884" }
                }
              >
                {t === "campaign"
                  ? `En campaña ${leads.length > 0 ? `(${leads.length})` : ""}`
                  : `Por enviar ${pending.length > 0 ? `(${pending.length})` : ""}`}
              </button>
            ))}
          </div>

          {/* Tab: En campaña */}
          {tab === "campaign" && (
            <div className="space-y-3">
              {/* Buscador + filtro */}
              <div className="flex gap-2 items-center">
                <div className="relative flex-1 max-w-md">
                  <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por nombre, empresa o email…"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-[#E5E2F0] rounded-lg outline-none focus:border-[#62E0D8] bg-white"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink">
                      <IconX size={13} />
                    </button>
                  )}
                </div>

                {/* Filtro de estado */}
                <div className="flex gap-1 flex-wrap">
                  {(Object.keys(FILTER_LABELS) as FilterState[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className="text-xs px-2.5 py-1.5 rounded-full border transition"
                      style={
                        filter === f
                          ? { background: "#251762", color: "white", borderColor: "#251762" }
                          : { background: "white", color: "#6B6884", borderColor: "#E5E2F0" }
                      }
                    >
                      {FILTER_LABELS[f]}
                      {f !== "all" && counts[f as keyof typeof counts] > 0 && (
                        <span className="ml-1 opacity-70">{counts[f as keyof typeof counts]}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lista */}
              {filteredLeads.length === 0 ? (
                <div className="text-center py-12 text-ink-muted text-sm">
                  {search || filter !== "all"
                    ? "Sin resultados para este filtro."
                    : leads.length === 0
                    ? "No hay leads en la campaña aún."
                    : "Sin resultados."}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredLeads.map((lead) => (
                    <LeadCard
                      key={lead._id || lead.email}
                      lead={lead}
                      campaignId={campaign?._id ?? ""}
                      onPauseToggle={handlePauseToggle}
                    />
                  ))}
                  {filteredLeads.length < leads.length && (
                    <p className="text-xs text-center text-ink-muted pt-2">
                      Mostrando {filteredLeads.length} de {leads.length} leads
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tab: Por enviar */}
          {tab === "pending" && (
            <div className="space-y-3">
              {pending.length === 0 ? (
                <div className="text-center py-12 text-ink-muted text-sm">
                  No hay contactos pendientes de envío.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-ink-muted">
                      {pending.length} contacto{pending.length !== 1 ? "s" : ""} aprobado{pending.length !== 1 ? "s" : ""} para enviar a Lemlist
                    </p>
                    <button
                      onClick={pushAll}
                      disabled={pushing}
                      className="btn-primary flex items-center gap-1.5 text-sm"
                    >
                      {pushing ? <IconLoader2 size={14} className="animate-spin" /> : <IconSend size={14} />}
                      Enviar todos
                    </button>
                  </div>

                  <div className="space-y-2">
                    {pending.map((c) => (
                      <div key={c.id} className="card px-4 py-3 flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
                          style={{ background: "#251762" }}
                        >
                          {[c.first_name?.[0], c.last_name?.[0]].filter(Boolean).join("").toUpperCase() || "?"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-ink">
                            {[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}
                            {c.company_name && <span className="text-ink-muted font-normal"> · {c.company_name}</span>}
                          </div>
                          {c.job_title && <div className="text-xs text-ink-muted">{c.job_title}</div>}
                        </div>
                        {c.email ? (
                          <span className="text-xs text-ink-muted hidden md:block">{c.email}</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded" style={{ background: "#FEE2E2", color: "#991B1B" }}>
                            Sin email
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
