"use client";

import { useEffect, useState, useCallback } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconMail,
  IconAlertCircle,
  IconRefresh,
  IconSend,
  IconCheck,
  IconLoader2,
  IconBrandLinkedin,
  IconUsers,
  IconMailOpened,
  IconMailFast,
  IconAlertTriangle,
  IconSquare,
  IconSquareCheck
} from "@tabler/icons-react";
import Link from "next/link";

// ─── Tipos ────────────────────────────────────────────────────────────────────

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

type PendingContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  company_id: string;
  company_name?: string;
};

type LeadStatus =
  | "replied"
  | "bounced"
  | "clicked"
  | "opened"
  | "unsubscribed"
  | "active";

type CampaignLead = {
  _id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  status?: LeadStatus;
  isPaused?: boolean;
  isReplied?: boolean;
  isBounced?: boolean;
  isOpened?: boolean;
  isClicked?: boolean;
  isUnsubscribed?: boolean;
};

type Tab = "pending" | "in_campaign";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(num: number, denom: number): string {
  if (!denom) return "0%";
  return `${Math.round((num / denom) * 100)}%`;
}

function leadStatus(lead: CampaignLead): LeadStatus {
  if (lead.isReplied)      return "replied";
  if (lead.isBounced)      return "bounced";
  if (lead.isClicked)      return "clicked";
  if (lead.isOpened)       return "opened";
  if (lead.isUnsubscribed) return "unsubscribed";
  return lead.status ?? "active";
}

const STATUS_LABELS: Record<LeadStatus, string> = {
  replied:       "Respondió",
  bounced:       "Rebotó",
  clicked:       "Hizo clic",
  opened:        "Abrió",
  unsubscribed:  "Desuscrito",
  active:        "Activo",
};

const STATUS_STYLES: Record<LeadStatus, string> = {
  replied:      "bg-success-bg text-success-fg",
  bounced:      "bg-danger-bg text-danger-fg",
  clicked:      "bg-[rgba(98,224,216,0.15)] text-[#0F6E56]",
  opened:       "bg-blue-50 text-blue-700",
  unsubscribed: "bg-gray-100 text-gray-500",
  active:       "bg-[#F1EEF7] text-ink-muted",
};

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CampanasPage() {
  const { currentClient } = useClient();
  const [tab, setTab] = useState<Tab>("pending");

  // Stats campaña
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Tab "Por enviar"
  const [pendingContacts, setPendingContacts] = useState<PendingContact[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState(false);
  const [pushNotice, setPushNotice] = useState<string | null>(null);

  // Tab "En campaña"
  const [campaignLeads, setCampaignLeads] = useState<CampaignLead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState<string | null>(null);

  // ID de campaña para URL de Lemlist
  const campaignId = campaign?._id ?? null;

  // ── Cargar stats de la campaña ──────────────────────────────────────────────

  const loadCampaignStats = useCallback(async () => {
    if (!currentClient) return;
    setStatsLoading(true);
    setStatsError(null);
    try {
      const res = await fetch(`/api/lemlist/campaigns?client_id=${currentClient.id}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setStatsError(data.error ?? "Error al cargar campaña");
        return;
      }
      setCampaign(data.campaign);
      setStats(data.stats);
    } catch {
      setStatsError("Error de red al cargar campaña");
    } finally {
      setStatsLoading(false);
    }
  }, [currentClient?.id]);

  // ── Cargar contactos pendientes de enviar ────────────────────────────────────

  const loadPendingContacts = useCallback(async () => {
    if (!currentClient) return;
    setPendingLoading(true);
    setPendingError(null);
    setSelected(new Set());
    try {
      // Obtener contactos con fit_action='enrich', lemlist_pushed_at IS NULL, status != 'discarded'
      const res = await fetch(
        `/api/contacts?bucket=approved_pending&client_id=${currentClient.id}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) {
        setPendingError(data.error ?? "Error al cargar contactos");
        return;
      }

      // Obtener nombres de empresas
      const contacts: any[] = data.contacts ?? [];
      const companyIds = [...new Set(contacts.map((c) => c.company_id).filter(Boolean))];

      let companyNames: Record<string, string> = {};
      if (companyIds.length > 0) {
        const compRes = await fetch(
          `/api/companies?status=approved&client_id=${currentClient.id}`,
          { cache: "no-store" }
        );
        const compData = await compRes.json();
        for (const c of compData.companies ?? []) {
          companyNames[c.id] = c.company_name;
        }
      }

      setPendingContacts(
        contacts.map((c) => ({
          ...c,
          company_name: companyNames[c.company_id] ?? "",
        }))
      );
    } catch {
      setPendingError("Error de red al cargar contactos");
    } finally {
      setPendingLoading(false);
    }
  }, [currentClient?.id]);

  // ── Cargar leads en campaña ──────────────────────────────────────────────────

  const loadCampaignLeads = useCallback(async () => {
    if (!currentClient || !campaignId) return;
    setLeadsLoading(true);
    setLeadsError(null);
    try {
      const apiKey = ""; // No se puede acceder al apiKey en client-side; usar endpoint proxy
      // Usamos el endpoint de campañas existente como proxy para obtener el ID
      // y luego obtenemos leads desde el endpoint correcto
      const res = await fetch(
        `/api/lemlist/campaigns/leads?client_id=${currentClient.id}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        // Fallback: mostrar mensaje de error sin bloquear
        setLeadsError("No se pudo cargar la lista de leads. Verifica la configuración.");
        return;
      }
      const data = await res.json();
      setCampaignLeads(data.leads ?? []);
    } catch {
      setLeadsError("Error de red al cargar leads");
    } finally {
      setLeadsLoading(false);
    }
  }, [currentClient?.id, campaignId]);

  // ── Efectos ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (currentClient) {
      loadCampaignStats();
    }
  }, [currentClient?.id]);

  useEffect(() => {
    if (!currentClient) return;
    if (tab === "pending") {
      loadPendingContacts();
    } else {
      loadCampaignLeads();
    }
  }, [tab, currentClient?.id]);

  // ── Selección ────────────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === pendingContacts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingContacts.map((c) => c.id)));
    }
  }

  // ── Push a Lemlist ────────────────────────────────────────────────────────────

  async function pushToLemlist(contactIds?: string[]) {
    if (!currentClient) return;
    setPushing(true);
    setPushNotice(null);
    try {
      const res = await fetch("/api/lemlist/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: currentClient.id,
          contact_ids: contactIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPushNotice(`Error: ${data.error ?? "Push fallido"}`);
        return;
      }
      const errCount = data.errors?.length ?? 0;
      setPushNotice(
        `${data.pushed} enviados a Lemlist · ${data.skipped} sin email saltados${
          errCount > 0 ? ` · ${errCount} errores` : ""
        }`
      );
      await loadPendingContacts();
      await loadCampaignStats();
    } catch {
      setPushNotice("Error de red al enviar a Lemlist");
    } finally {
      setPushing(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Aviso: sin cliente seleccionado */}
      {!currentClient && (
        <div className="card flex items-center gap-3 border border-warning-bg bg-warning-bg/40 text-warning-fg text-sm">
          <IconAlertCircle size={16} className="shrink-0" />
          Selecciona un cliente en el sidebar para ver sus campañas.
        </div>
      )}

      {/* Header */}
      <header>
        <div className="label">Outreach</div>
        <h1 className="text-2xl font-semibold tracking-tight">Campañas email</h1>
        <div className="text-sm text-ink-muted mt-1">
          Gestión de outreach por email vía Lemlist
        </div>
      </header>

      {/* Stats de campaña */}
      {currentClient && (
        <div className="card space-y-3">
          {statsLoading ? (
            <div className="flex items-center gap-2 text-ink-muted text-sm">
              <IconLoader2 size={16} className="animate-spin" />
              Cargando campaña…
            </div>
          ) : statsError ? (
            <div className="flex items-start gap-3 text-sm">
              <IconAlertCircle size={16} className="text-warning-fg shrink-0 mt-0.5" />
              <div>
                <span className="text-ink-muted">{statsError}</span>
                {statsError.includes("Config. cliente") && (
                  <Link
                    href="/configuracion/cliente"
                    className="ml-2 text-brand underline"
                  >
                    Ir a Config. cliente
                  </Link>
                )}
              </div>
            </div>
          ) : campaign ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <IconMail size={16} style={{ color: "#62E0D8" }} />
                  <span className="font-semibold">{campaign.name}</span>
                  <span
                    className={`badge ${
                      campaign.isStarted
                        ? "bg-success-bg text-success-fg"
                        : "bg-[#F1EEF7] text-ink-muted"
                    }`}
                  >
                    {campaign.isStarted ? "Activa" : "Pausada"}
                  </span>
                </div>
                <button
                  onClick={loadCampaignStats}
                  className="btn-secondary text-xs"
                >
                  <IconRefresh size={13} />
                </button>
              </div>
              {stats && (
                <div className="flex flex-wrap gap-3 mt-1">
                  <StatChip label="Enviados" value={stats.contacted} color="text-ink" />
                  <StatChip
                    label="Abiertos"
                    value={`${pct(stats.opened, stats.contacted)}`}
                    color="text-blue-600"
                  />
                  <StatChip
                    label="Replies"
                    value={`${pct(stats.replied, stats.contacted)}`}
                    color="text-[#0F6E56]"
                  />
                  <StatChip
                    label="Clics"
                    value={`${pct(stats.clicked, stats.contacted)}`}
                    color="text-[#62E0D8]"
                  />
                  <StatChip label="Rebotados" value={stats.bounced} color="text-danger-fg" />
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Tabs */}
      {currentClient && (
        <>
          <div className="flex items-center gap-2">
            {(["pending", "in_campaign"] as Tab[]).map((t) => {
              const active = tab === t;
              const label = t === "pending" ? "Por enviar" : "En campaña";
              const count = t === "pending" ? pendingContacts.length : campaignLeads.length;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
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

          {/* ── Tab: Por enviar ── */}
          {tab === "pending" && (
            <div className="space-y-4">
              {/* Barra de acciones */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  {pendingContacts.length > 0 && (
                    <button onClick={toggleAll} className="btn-secondary text-xs">
                      {selected.size === pendingContacts.length ? (
                        <IconSquareCheck size={14} />
                      ) : (
                        <IconSquare size={14} />
                      )}
                      {selected.size === pendingContacts.length
                        ? "Deseleccionar todo"
                        : "Seleccionar todo"}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selected.size > 0 && (
                    <button
                      onClick={() => pushToLemlist([...selected])}
                      disabled={pushing}
                      className="btn-primary text-xs"
                    >
                      {pushing ? (
                        <IconLoader2 size={13} className="animate-spin" />
                      ) : (
                        <IconSend size={13} />
                      )}
                      {pushing
                        ? "Enviando…"
                        : `Enviar seleccionados (${selected.size})`}
                    </button>
                  )}
                  {pendingContacts.length > 0 && (
                    <button
                      onClick={() => pushToLemlist()}
                      disabled={pushing}
                      className="btn-primary text-xs"
                    >
                      {pushing ? (
                        <IconLoader2 size={13} className="animate-spin" />
                      ) : (
                        <IconMailFast size={13} />
                      )}
                      {pushing ? "Enviando…" : `Enviar todos (${pendingContacts.length})`}
                    </button>
                  )}
                  <button
                    onClick={loadPendingContacts}
                    disabled={pendingLoading}
                    className="btn-secondary text-xs"
                  >
                    <IconRefresh size={13} />
                  </button>
                </div>
              </div>

              {/* Notificación push */}
              {pushNotice && (
                <div className="card border border-success-bg text-success-fg flex items-center gap-2 text-sm">
                  <IconCheck size={15} />
                  {pushNotice}
                </div>
              )}

              {/* Error */}
              {pendingError && (
                <div className="card border border-danger-bg text-danger-fg flex items-center gap-2 text-sm">
                  <IconAlertCircle size={15} />
                  {pendingError}
                </div>
              )}

              {/* Lista */}
              {pendingLoading ? (
                <div className="flex items-center gap-2 text-ink-muted text-sm">
                  <IconLoader2 size={16} className="animate-spin" />
                  Cargando contactos…
                </div>
              ) : pendingContacts.length === 0 ? (
                <div className="card flex items-center gap-2 text-ink-muted text-sm">
                  <IconUsers size={16} />
                  No hay contactos aprobados pendientes de enviar.
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingContacts.map((c) => {
                    const isSelected = selected.has(c.id);
                    const fullName =
                      [c.first_name, c.last_name].filter(Boolean).join(" ") || "(sin nombre)";
                    return (
                      <div
                        key={c.id}
                        onClick={() => toggleSelect(c.id)}
                        className={`card flex items-center gap-4 cursor-pointer transition ${
                          isSelected
                            ? "border-2 border-brand-soft"
                            : "border border-transparent hover:border-[#E5E2F0]"
                        }`}
                        style={{ padding: "12px 16px" }}
                      >
                        <div className="shrink-0 text-ink-muted">
                          {isSelected ? (
                            <IconSquareCheck size={18} style={{ color: "#62E0D8" }} />
                          ) : (
                            <IconSquare size={18} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{fullName}</span>
                            {c.company_name && (
                              <span className="text-xs text-ink-muted">
                                · {c.company_name}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-ink-muted mt-0.5">
                            {c.job_title || "—"}
                          </div>
                        </div>
                        <div className="shrink-0">
                          {c.email ? (
                            <span className="badge bg-success-bg text-success-fg">
                              {c.email}
                            </span>
                          ) : (
                            <span className="badge bg-danger-bg text-danger-fg">
                              Sin email
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Tab: En campaña ── */}
          {tab === "in_campaign" && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button
                  onClick={loadCampaignLeads}
                  disabled={leadsLoading}
                  className="btn-secondary text-xs"
                >
                  <IconRefresh size={13} />
                  Refrescar
                </button>
              </div>

              {leadsError && (
                <div className="card border border-warning-bg text-warning-fg flex items-start gap-2 text-sm">
                  <IconAlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <div>
                    {leadsError}
                    {campaignId && (
                      <a
                        href="https://app.lemlist.com"
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 underline text-brand"
                      >
                        Ver en Lemlist
                      </a>
                    )}
                  </div>
                </div>
              )}

              {leadsLoading ? (
                <div className="flex items-center gap-2 text-ink-muted text-sm">
                  <IconLoader2 size={16} className="animate-spin" />
                  Cargando leads…
                </div>
              ) : campaignLeads.length === 0 && !leadsError ? (
                <div className="card flex items-center gap-2 text-ink-muted text-sm">
                  <IconMailOpened size={16} />
                  No hay leads en campaña todavía.
                </div>
              ) : (
                <div className="space-y-2">
                  {campaignLeads.map((lead) => {
                    const status = leadStatus(lead);
                    const fullName =
                      [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
                      lead.email ||
                      "(sin nombre)";
                    return (
                      <div
                        key={lead._id}
                        className="card flex items-center gap-4"
                        style={{ padding: "12px 16px" }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{fullName}</span>
                            {lead.companyName && (
                              <span className="text-xs text-ink-muted">
                                · {lead.companyName}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-ink-muted mt-0.5">{lead.email}</div>
                        </div>
                        <span className={`badge ${STATUS_STYLES[status]}`}>
                          {STATUS_LABELS[status]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Componente helper ────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-2 rounded-lg bg-[#F4F2FB] min-w-[80px]">
      <span className={`text-lg font-bold ${color}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-ink-muted mt-0.5">{label}</span>
    </div>
  );
}
