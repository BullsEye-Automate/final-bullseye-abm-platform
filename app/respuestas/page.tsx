"use client";

import { useEffect, useState, useCallback } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconMessage2,
  IconAlertCircle,
  IconRefresh,
  IconCheck,
  IconX,
  IconExternalLink,
  IconLoader2,
  IconClock
} from "@tabler/icons-react";
import Link from "next/link";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Reply = {
  activity_id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  text: string | null;
  created_at: string | null;
  contact_id: string | null;
  contact_status: string | null;
  job_title: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours   = Math.floor(diff / 3_600_000);
  const days    = Math.floor(diff / 86_400_000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  if (hours < 24)   return `hace ${hours} h`;
  if (days === 1)   return "ayer";
  if (days < 7)     return `hace ${days} días`;
  return date.toLocaleDateString("es", { day: "numeric", month: "short" });
}

function snippet(text: string | null, maxLen = 200): string {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() + "…" : text;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function RespuestasPage() {
  const { currentClient } = useClient();
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado de acciones por reply (activo mientras se procesa)
  const [actionPending, setActionPending] = useState<Record<string, boolean>>({});
  // Estado actualizado localmente tras acción (para mostrar badge inmediato)
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({});

  // ID de campaña para link a Lemlist
  const [campaignId, setCampaignId] = useState<string | null>(null);

  // ── Cargar campaña ───────────────────────────────────────────────────────────

  const loadCampaignId = useCallback(async () => {
    if (!currentClient) return;
    try {
      const res = await fetch(`/api/lemlist/campaigns?client_id=${currentClient.id}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setCampaignId(data.campaign?._id ?? null);
      }
    } catch {
      // silenciar — no crítico
    }
  }, [currentClient?.id]);

  // ── Cargar respuestas ─────────────────────────────────────────────────────────

  const loadReplies = useCallback(async () => {
    if (!currentClient) return;
    setLoading(true);
    setError(null);
    setLocalStatus({});
    try {
      const res = await fetch(`/api/lemlist/replies?client_id=${currentClient.id}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al cargar respuestas");
        return;
      }
      setReplies(data.replies ?? []);
    } catch {
      setError("Error de red al cargar respuestas");
    } finally {
      setLoading(false);
    }
  }, [currentClient?.id]);

  // ── Efectos ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (currentClient) {
      loadReplies();
      loadCampaignId();
    }
  }, [currentClient?.id]);

  // ── Actualizar status del contacto ────────────────────────────────────────────

  async function updateContactStatus(
    contactId: string,
    activityId: string | null,
    newStatus: "replied" | "discarded"
  ) {
    const key = activityId ?? contactId;
    setActionPending((prev) => ({ ...prev, [key]: true }));
    try {
      if (newStatus === "replied") {
        // Para "interesado" marcamos status = 'replied' directamente en contacts
        const res = await fetch(`/api/contacts/${contactId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "replied" }),
        });
        if (res.ok) {
          setLocalStatus((prev) => ({ ...prev, [key]: "replied" }));
        }
      } else {
        // Para "no interesado" usamos el decision endpoint existente
        const res = await fetch(`/api/contacts/${contactId}/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "rejected" }),
        });
        if (res.ok) {
          setLocalStatus((prev) => ({ ...prev, [key]: "discarded" }));
        }
      }
    } catch {
      // silenciar error puntual
    } finally {
      setActionPending((prev) => ({ ...prev, [key]: false }));
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  const total = replies.length;
  const interested = replies.filter((r) => {
    const key = r.activity_id ?? r.contact_id ?? "";
    const s = localStatus[key] ?? r.contact_status;
    return s === "replied";
  }).length;
  const notInterested = replies.filter((r) => {
    const key = r.activity_id ?? r.contact_id ?? "";
    const s = localStatus[key] ?? r.contact_status;
    return s === "discarded";
  }).length;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Aviso: sin cliente */}
      {!currentClient && (
        <div className="card flex items-center gap-3 border border-warning-bg bg-warning-bg/40 text-warning-fg text-sm">
          <IconAlertCircle size={16} className="shrink-0" />
          Selecciona un cliente en el sidebar para ver sus respuestas.
        </div>
      )}

      {/* Header */}
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="label">SDR</div>
          <h1 className="text-2xl font-semibold tracking-tight">Respuestas</h1>
          <div className="text-sm text-ink-muted mt-1">
            Respuestas recibidas en campañas de email
          </div>
        </div>
        {currentClient && (
          <button
            onClick={loadReplies}
            disabled={loading}
            className="btn-secondary"
          >
            <IconRefresh size={14} />
            Refrescar
          </button>
        )}
      </header>

      {/* Stats chips */}
      {currentClient && !loading && replies.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <StatChip label="Total replies" value={total} color="text-ink" />
          <StatChip label="Interesados" value={interested} color="text-[#0F6E56]" />
          <StatChip label="No interesados" value={notInterested} color="text-danger-fg" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card border border-warning-bg text-warning-fg flex items-start gap-2 text-sm">
          <IconAlertCircle size={15} className="shrink-0 mt-0.5" />
          <div>
            {error}
            {error.includes("Config. cliente") && (
              <Link href="/configuracion/cliente" className="ml-2 underline text-brand">
                Ir a Config. cliente
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-ink-muted text-sm">
          <IconLoader2 size={16} className="animate-spin" />
          Cargando respuestas…
        </div>
      )}

      {/* Empty state */}
      {!loading && currentClient && replies.length === 0 && !error && (
        <div className="card flex items-center gap-2 text-ink-muted text-sm">
          <IconMessage2 size={16} />
          No hay respuestas registradas todavía.
        </div>
      )}

      {/* Feed de respuestas */}
      {!loading && replies.length > 0 && (
        <div className="space-y-4">
          {replies.map((reply) => {
            const key = reply.activity_id ?? reply.contact_id ?? Math.random().toString();
            const currentStatus = localStatus[key] ?? reply.contact_status;
            const isProcessing = actionPending[key] ?? false;
            const fullName =
              [reply.first_name, reply.last_name].filter(Boolean).join(" ") ||
              reply.email ||
              "(sin nombre)";

            return (
              <div key={key} className="card space-y-3">
                {/* Cabecera */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{fullName}</span>
                      {reply.company_name && (
                        <span className="text-sm text-ink-muted">· {reply.company_name}</span>
                      )}
                      {/* Badge de estado */}
                      {currentStatus === "replied" && (
                        <span className="badge bg-success-bg text-success-fg">
                          Interesado ✓
                        </span>
                      )}
                      {currentStatus === "discarded" && (
                        <span className="badge bg-danger-bg text-danger-fg">
                          No interesado ✗
                        </span>
                      )}
                    </div>
                    {reply.job_title && (
                      <div className="text-xs text-ink-muted mt-0.5">{reply.job_title}</div>
                    )}
                    {reply.email && (
                      <div className="text-xs text-ink-muted">{reply.email}</div>
                    )}
                  </div>
                  {/* Fecha */}
                  {reply.created_at && (
                    <div className="shrink-0 flex items-center gap-1 text-xs text-ink-muted">
                      <IconClock size={12} />
                      {timeAgo(reply.created_at)}
                    </div>
                  )}
                </div>

                {/* Texto de la respuesta */}
                {reply.text && (
                  <div className="rounded-lg bg-[#F4F2FB] px-4 py-3 text-sm text-ink/90 whitespace-pre-line">
                    {snippet(reply.text)}
                  </div>
                )}

                {/* Acciones */}
                <div className="flex items-center gap-2 justify-end pt-1 flex-wrap">
                  {/* Botones sólo si hay contact_id */}
                  {reply.contact_id && currentStatus !== "replied" && currentStatus !== "discarded" && (
                    <>
                      <button
                        onClick={() =>
                          updateContactStatus(reply.contact_id!, reply.activity_id, "replied")
                        }
                        disabled={isProcessing}
                        className="btn-secondary text-xs"
                      >
                        {isProcessing ? (
                          <IconLoader2 size={13} className="animate-spin" />
                        ) : (
                          <IconCheck size={13} style={{ color: "#0F6E56" }} />
                        )}
                        Interesado
                      </button>
                      <button
                        onClick={() =>
                          updateContactStatus(reply.contact_id!, reply.activity_id, "discarded")
                        }
                        disabled={isProcessing}
                        className="btn-secondary text-xs"
                      >
                        {isProcessing ? (
                          <IconLoader2 size={13} className="animate-spin" />
                        ) : (
                          <IconX size={13} style={{ color: "#993C1D" }} />
                        )}
                        No interesado
                      </button>
                    </>
                  )}

                  {/* Undo para replies marcadas */}
                  {reply.contact_id &&
                    (currentStatus === "replied" || currentStatus === "discarded") && (
                      <button
                        onClick={() =>
                          updateContactStatus(reply.contact_id!, reply.activity_id,
                            currentStatus === "replied" ? "discarded" : "replied")
                        }
                        disabled={isProcessing}
                        className="btn-secondary text-xs"
                      >
                        Cambiar estado
                      </button>
                    )}

                  {/* Link a Lemlist */}
                  {campaignId && (
                    <a
                      href="https://app.lemlist.com"
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary text-xs"
                    >
                      <IconExternalLink size={13} />
                      Ver en Lemlist
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
  value: number;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-2 rounded-lg bg-[#F4F2FB] min-w-[90px]">
      <span className={`text-lg font-bold ${color}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-ink-muted mt-0.5">{label}</span>
    </div>
  );
}
