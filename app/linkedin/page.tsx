"use client";

import { useEffect, useState, useCallback } from "react";
import { useClient } from "@/lib/clientContext";
import {
  IconBrandLinkedin,
  IconCheck,
  IconAlertCircle,
  IconRefresh,
  IconLoader2,
  IconCopy,
  IconExternalLink,
  IconUsers,
  IconClockHour4,
  IconMessageCircle
} from "@tabler/icons-react";

// Tipo para contacto con datos relevantes para LinkedIn outreach
type Contact = {
  id: string;
  company_id: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  linkedin_icebreaker: string | null;
  status: string;
  updated_at?: string | null;
  created_at: string;
  // Empresa enriquecida mediante join (puede no existir)
  company_name?: string | null;
};

type Tab = "por_contactar" | "contactados" | "con_respuesta";

const TAB_LABELS: Record<Tab, string> = {
  por_contactar: "Por contactar",
  contactados: "Contactados",
  con_respuesta: "Con respuesta"
};

// Fecha relativa en español
function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "hace un momento";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `hace ${diffD} día${diffD > 1 ? "s" : ""}`;
  return date.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

export default function LinkedInPage() {
  const { currentClient } = useClient();
  const [activeTab, setActiveTab] = useState<Tab>("por_contactar");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Cargar contactos según el tab activo
  const loadContacts = useCallback(async (tab: Tab) => {
    if (!currentClient) return;
    setLoading(true);
    setError(null);

    // Construir query según tab
    // Tab "por_contactar": contactos enriquecidos con linkedin, listos para outreach
    // Tab "contactados": status='contacted'
    // Tab "con_respuesta": status='replied'
    const clientParam = `client_id=${currentClient.id}`;
    let statusFilter = "";

    if (tab === "por_contactar") {
      // Bucket: fit_action=enrich, linkedin_url IS NOT NULL, no contactados ni descartados
      statusFilter = "&bucket=linkedin_pending";
    } else if (tab === "contactados") {
      statusFilter = "&status=contacted";
    } else if (tab === "con_respuesta") {
      statusFilter = "&status=replied";
    }

    try {
      const res = await fetch(
        `/api/contacts/linkedin?${clientParam}${statusFilter}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error cargando contactos");
      } else {
        setContacts(data.contacts ?? []);
      }
    } catch {
      setError("Error de red al cargar contactos");
    }
    setLoading(false);
  }, [currentClient]);

  useEffect(() => {
    loadContacts(activeTab);
  }, [activeTab, loadContacts]);

  // Actualizar status de un contacto
  async function updateStatus(contactId: string, status: "contacted" | "replied") {
    setUpdatingId(contactId);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error actualizando contacto");
      } else {
        const label = status === "contacted" ? "Marcado como enviado" : "Marcado como respondió";
        setSuccessMsg(label);
        setTimeout(() => setSuccessMsg(null), 3500);
        await loadContacts(activeTab);
      }
    } catch {
      setError("Error de red al actualizar contacto");
    }
    setUpdatingId(null);
  }

  const counts = {
    por_contactar: activeTab === "por_contactar" ? contacts.length : 0,
    contactados: activeTab === "contactados" ? contacts.length : 0,
    con_respuesta: activeTab === "con_respuesta" ? contacts.length : 0
  };

  return (
    <div className="space-y-6">
      {/* Aviso sin cliente */}
      {!currentClient && (
        <div className="card flex items-center gap-3 border border-warning-bg bg-warning-bg/40 text-warning-fg text-sm">
          <IconAlertCircle size={16} className="shrink-0" />
          Selecciona un cliente en el sidebar para ver los contactos de LinkedIn.
        </div>
      )}

      {/* Header */}
      <header className="flex items-end justify-between">
        <div>
          <div className="label">Outreach</div>
          <h1 className="text-2xl font-semibold tracking-tight">LinkedIn</h1>
          <div className="text-sm text-ink-muted mt-1">
            Gestión del outreach por LinkedIn — icebreakers y seguimiento manual.
          </div>
        </div>
        <button
          onClick={() => loadContacts(activeTab)}
          disabled={loading || !currentClient}
          className="btn-secondary"
          title="Refrescar lista"
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
          {/* Tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            {(["por_contactar", "contactados", "con_respuesta"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`btn ${
                  activeTab === tab
                    ? "bg-brand text-white"
                    : "bg-white border border-[#E5E2F0] text-ink hover:border-brand-soft"
                }`}
              >
                {TAB_LABELS[tab]}
                {activeTab === tab && contacts.length > 0 && (
                  <span
                    className={`ml-1 inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[11px] font-semibold ${
                      activeTab === tab ? "bg-white/20 text-white" : "bg-[#F1EEF7] text-ink-muted"
                    }`}
                  >
                    {contacts.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Mensajes de feedback */}
          {successMsg && (
            <div className="card border border-success-bg text-success-fg flex items-center gap-2">
              <IconCheck size={16} />
              {successMsg}
            </div>
          )}
          {error && (
            <div className="card border border-danger-bg text-danger-fg flex items-center gap-2">
              <IconAlertCircle size={16} />
              {error}
            </div>
          )}

          {/* Contenido del tab activo */}
          {loading ? (
            <div className="flex items-center gap-3 text-ink-muted py-12 justify-center">
              <IconLoader2 size={22} className="animate-spin" />
              <span>Cargando contactos…</span>
            </div>
          ) : (
            <>
              {activeTab === "por_contactar" && (
                <PorContactarTab
                  contacts={contacts}
                  onMarkContacted={(id) => updateStatus(id, "contacted")}
                  updatingId={updatingId}
                />
              )}
              {activeTab === "contactados" && (
                <ContactadosTab
                  contacts={contacts}
                  onMarkReplied={(id) => updateStatus(id, "replied")}
                  updatingId={updatingId}
                />
              )}
              {activeTab === "con_respuesta" && (
                <ConRespuestaTab contacts={contacts} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Tab "Por contactar" ────────────────────────────────────────────────────

function PorContactarTab({
  contacts,
  onMarkContacted,
  updatingId
}: {
  contacts: Contact[];
  onMarkContacted: (id: string) => void;
  updatingId: string | null;
}) {
  if (contacts.length === 0) {
    return (
      <div className="card flex items-center gap-3 text-ink-muted">
        <IconUsers size={18} className="shrink-0" />
        No hay contactos listos para outreach LinkedIn. Los contactos enriquecidos con
        linkedin_url aparecerán aquí.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {contacts.map((c) => (
        <PorContactarCard
          key={c.id}
          contact={c}
          onMarkContacted={onMarkContacted}
          isUpdating={updatingId === c.id}
        />
      ))}
    </div>
  );
}

function PorContactarCard({
  contact: c,
  onMarkContacted,
  isUpdating
}: {
  contact: Contact;
  onMarkContacted: (id: string) => void;
  isUpdating: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ") || "(sin nombre)";

  async function copyIcebreaker() {
    if (!c.linkedin_icebreaker) return;
    await navigator.clipboard.writeText(c.linkedin_icebreaker);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card flex flex-col gap-3">
      {/* Header del contacto */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{fullName}</h3>
          <div className="text-xs text-ink-muted mt-0.5">
            {c.job_title ?? "(sin cargo)"}
            {c.company_name ? ` · ${c.company_name}` : ""}
          </div>
        </div>
        {/* Botón abrir LinkedIn */}
        {c.linkedin_url && (
          <a
            href={c.linkedin_url}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary shrink-0"
            title="Abrir LinkedIn"
          >
            <IconBrandLinkedin size={15} />
            Abrir LinkedIn
          </a>
        )}
      </div>

      {/* Icebreaker */}
      {c.linkedin_icebreaker ? (
        <div>
          <div className="label mb-1 flex items-center gap-1">
            <IconMessageCircle size={11} />
            Icebreaker LinkedIn
          </div>
          <div
            className="relative rounded-lg p-3 text-sm leading-relaxed"
            style={{
              background: "rgba(37,23,98,0.04)",
              border: "1px solid rgba(37,23,98,0.08)"
            }}
          >
            <p className="text-ink/90 pr-8">{c.linkedin_icebreaker}</p>
            <button
              onClick={copyIcebreaker}
              className="absolute top-2 right-2 p-1.5 rounded-md transition hover:bg-white"
              title="Copiar icebreaker"
            >
              {copied ? (
                <IconCheck size={14} style={{ color: "#0F6E56" }} />
              ) : (
                <IconCopy size={14} className="text-ink-muted" />
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-ink-muted rounded-lg px-3 py-2 bg-[#F4F2FB]">
          <IconAlertCircle size={13} className="shrink-0" />
          Sin icebreaker — genera mensajes personalizados en Clay primero.
        </div>
      )}

      {/* Botón marcar enviado */}
      <div className="flex justify-end">
        <button
          onClick={() => onMarkContacted(c.id)}
          disabled={isUpdating}
          className="btn-primary text-sm"
        >
          {isUpdating ? (
            <IconLoader2 size={14} className="animate-spin" />
          ) : (
            <IconCheck size={14} />
          )}
          {isUpdating ? "Actualizando…" : "Marcar enviado"}
        </button>
      </div>
    </div>
  );
}

// ── Tab "Contactados" ──────────────────────────────────────────────────────

function ContactadosTab({
  contacts,
  onMarkReplied,
  updatingId
}: {
  contacts: Contact[];
  onMarkReplied: (id: string) => void;
  updatingId: string | null;
}) {
  if (contacts.length === 0) {
    return (
      <div className="card flex items-center gap-3 text-ink-muted">
        <IconBrandLinkedin size={18} className="shrink-0" />
        No hay contactos en estado "contactado" todavía. Marca los enviados desde el tab
        "Por contactar".
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {contacts.map((c) => (
        <ContactadoCard
          key={c.id}
          contact={c}
          onMarkReplied={onMarkReplied}
          isUpdating={updatingId === c.id}
        />
      ))}
    </div>
  );
}

function ContactadoCard({
  contact: c,
  onMarkReplied,
  isUpdating
}: {
  contact: Contact;
  onMarkReplied: (id: string) => void;
  isUpdating: boolean;
}) {
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ") || "(sin nombre)";

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h3 className="font-semibold">{fullName}</h3>
            <span className="badge" style={{ background: "rgba(98,224,216,0.15)", color: "#0F6E56" }}>
              Enviado
            </span>
          </div>
          <div className="text-xs text-ink-muted">
            {c.job_title ?? "(sin cargo)"}
            {c.company_name ? ` · ${c.company_name}` : ""}
          </div>
          <div className="flex items-center gap-1 text-xs text-ink-muted mt-1">
            <IconClockHour4 size={11} />
            Contactado {timeAgo(c.updated_at ?? c.created_at)}
          </div>
        </div>

        {c.linkedin_url && (
          <a
            href={c.linkedin_url}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary shrink-0"
            title="Ver en LinkedIn"
          >
            <IconExternalLink size={14} />
          </a>
        )}
      </div>

      <div className="flex gap-2">
        {/* Botón respondió */}
        <button
          onClick={() => onMarkReplied(c.id)}
          disabled={isUpdating}
          className="btn-primary text-sm flex-1"
        >
          {isUpdating ? (
            <IconLoader2 size={14} className="animate-spin" />
          ) : (
            <IconCheck size={14} />
          )}
          {isUpdating ? "Actualizando…" : "Respondió"}
        </button>

        {/* Botón sin respuesta (visual, sin acción) */}
        <button
          disabled
          className="btn-secondary text-sm flex-1 opacity-40 cursor-not-allowed"
          title="No responde (sin acción)"
        >
          No responde
        </button>
      </div>
    </div>
  );
}

// ── Tab "Con respuesta" ────────────────────────────────────────────────────

function ConRespuestaTab({ contacts }: { contacts: Contact[] }) {
  if (contacts.length === 0) {
    return (
      <div className="card flex items-center gap-3 text-ink-muted">
        <IconMessageCircle size={18} className="shrink-0" />
        Aún no hay contactos que hayan respondido. Marca las respuestas desde el tab
        "Contactados".
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {contacts.map((c) => {
        const fullName =
          [c.first_name, c.last_name].filter(Boolean).join(" ") || "(sin nombre)";
        return (
          <div key={c.id} className="card flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <h3 className="font-semibold">{fullName}</h3>
                  <span className="badge bg-success-bg text-success-fg">
                    <IconCheck size={10} /> Respondió
                  </span>
                </div>
                <div className="text-xs text-ink-muted">
                  {c.job_title ?? "(sin cargo)"}
                  {c.company_name ? ` · ${c.company_name}` : ""}
                </div>
                <div className="flex items-center gap-1 text-xs text-ink-muted mt-1">
                  <IconClockHour4 size={11} />
                  {timeAgo(c.updated_at ?? c.created_at)}
                </div>
              </div>

              {c.linkedin_url && (
                <a
                  href={c.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary shrink-0"
                  title="Ver en LinkedIn"
                >
                  <IconBrandLinkedin size={15} />
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
