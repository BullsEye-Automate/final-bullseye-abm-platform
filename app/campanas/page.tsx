"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconRefresh,
  IconAlertCircle,
  IconCheck,
  IconBrandLinkedin,
  IconMail,
  IconExternalLink,
  IconMessage2
} from "@tabler/icons-react";

const LINKEDIN_STEPS = ["not_started", "visited", "invited", "connected", "replied"] as const;
const EMAIL_STEPS = ["not_started", "sent", "opened", "clicked", "replied"] as const;

type OutreachState = {
  linkedin_step: (typeof LINKEDIN_STEPS)[number];
  email_step: (typeof EMAIL_STEPS)[number];
  replied: boolean;
  bounced: boolean;
  unsubscribed: boolean;
  interested: boolean;
  last_activity_at: string | null;
  activity_count: number;
};

type OutreachContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  fit_score: number | null;
  lemlist_pushed_at: string | null;
  lemlist_push_error: string | null;
  hubspot_contact_id: string | null;
  state: OutreachState;
};

type Kpis = {
  total: number;
  replied: number;
  connected: number;
  interested: number;
  bounced: number;
  linkedin_engaged: number;
  emailed: number;
  no_response: number;
  no_activity: number;
};

const STEP_LABEL: Record<string, string> = {
  not_started: "sin iniciar",
  visited: "perfil visitado",
  invited: "invitación enviada",
  connected: "conectado",
  sent: "email enviado",
  opened: "email abierto",
  clicked: "clickeó",
  replied: "respondió"
};

const CHANNELS = [
  { key: "all", label: "Todos" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "email", label: "Email" }
] as const;

const STATES = [
  { key: "all", label: "Todos los estados" },
  { key: "replied", label: "Respondieron" },
  { key: "connected", label: "Conectaron (LinkedIn)" },
  { key: "interested", label: "Interesados" },
  { key: "in_progress", label: "En progreso" },
  { key: "no_response", label: "Sin respuesta" },
  { key: "bounced", label: "Bounces" }
] as const;

export default function CampanasPage() {
  const [channel, setChannel] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [contacts, setContacts] = useState<OutreachContact[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncDebug, setSyncDebug] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(
      `/api/lemlist/outreach?channel=${channel}&state=${stateFilter}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "No se pudo cargar el outreach");
      return;
    }
    setKpis(data.kpis);
    setContacts(data.contacts ?? []);
    setLastSyncAt(data.last_sync_at ?? null);
  }, [channel, stateFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    setSyncDebug(null);
    const res = await fetch("/api/lemlist/sync-activities", { method: "POST" });
    const data = await res.json();
    setSyncing(false);
    if (!res.ok) {
      setError(data.error ?? "La sincronización con Lemlist falló");
      if (data.debug) setSyncDebug(data.debug);
      return;
    }
    setNotice(
      `Sincronizado: ${data.fetched} actividades de Lemlist · ${data.matched} matcheadas a contactos.`
    );
    await load();
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="label">Outreach</div>
          <h1 className="text-2xl font-semibold tracking-tight">Campañas</h1>
          <div className="text-sm text-ink-muted mt-1">
            Estado de cada lead en la cadencia multicanal de Lemlist (LinkedIn + email).
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastSyncAt && (
            <div className="text-xs text-ink-muted">
              Último sync:{" "}
              {new Date(lastSyncAt).toLocaleString("es", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit"
              })}
            </div>
          )}
          <button onClick={sync} disabled={syncing} className="btn-primary">
            <IconRefresh size={16} /> {syncing ? "Sincronizando…" : "Sincronizar con Lemlist"}
          </button>
        </div>
      </header>

      {notice && (
        <div className="card text-sm flex items-center gap-2">
          <IconCheck size={16} className="text-success-fg" /> {notice}
        </div>
      )}
      {error && (
        <div className="card border border-danger-bg text-danger-fg flex items-start gap-2 text-sm">
          <IconAlertCircle size={16} className="shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div>{error}</div>
            {syncDebug != null && (
              <pre className="bg-[#F4F2FB] text-ink/70 rounded-md p-2 text-[11px] overflow-auto max-h-48">
                {JSON.stringify(syncDebug, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="En campaña" value={kpis.total} />
          <Kpi
            label="Respondieron"
            value={kpis.replied}
            sub={kpis.total > 0 ? `${Math.round((kpis.replied / kpis.total) * 100)}%` : undefined}
            tone="success"
          />
          <Kpi label="Conectados LinkedIn" value={kpis.connected} tone="info" />
          <Kpi label="Interesados" value={kpis.interested} tone="success" />
          <Kpi label="Bounces" value={kpis.bounced} tone="danger" />
          <Kpi label="Sin actividad aún" value={kpis.no_activity} tone="muted" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-[#F4F2FB] rounded-lg p-1">
          {CHANNELS.map((c) => (
            <button
              key={c.key}
              onClick={() => setChannel(c.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                channel === c.key ? "bg-white text-brand shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              {c.key === "linkedin" && <IconBrandLinkedin size={14} />}
              {c.key === "email" && <IconMail size={14} />}
              {c.label}
            </button>
          ))}
        </div>
        <select
          className="input w-auto"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          {STATES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          <IconRefresh size={14} /> Refrescar
        </button>
        <div className="text-sm text-ink-muted ml-auto">
          {contacts.length} {contacts.length === 1 ? "contacto" : "contactos"}
        </div>
      </div>

      {loading ? (
        <div className="text-ink-muted">Cargando…</div>
      ) : contacts.length === 0 ? (
        <div className="card text-ink-muted space-y-2">
          <div className="flex items-center gap-2">
            <IconMessage2 size={18} />
            No hay contactos para mostrar con estos filtros.
          </div>
          {(!kpis || kpis.total === 0) && (
            <div className="text-sm">
              Si recién configuras esto: corre la migración{" "}
              <code className="bg-[#F4F2FB] px-1 rounded">supabase/lemlist_activities_migration.sql</code>{" "}
              en Supabase y después haz clic en <strong>Sincronizar con Lemlist</strong> para traer la
              actividad de la campaña.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {contacts.map((c) => (
            <OutreachRow key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone = "default"
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "default" | "success" | "info" | "danger" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "text-success-fg"
      : tone === "info"
      ? "text-info-fg"
      : tone === "danger"
      ? "text-danger-fg"
      : tone === "muted"
      ? "text-ink-muted"
      : "text-ink";
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>
        {value}
        {sub && <span className="text-sm font-normal text-ink-muted ml-1">{sub}</span>}
      </div>
    </div>
  );
}

function Stepper({
  steps,
  current,
  label,
  icon
}: {
  steps: readonly string[];
  current: string;
  label: string;
  icon: React.ReactNode;
}) {
  const idx = steps.indexOf(current);
  return (
    <div className="min-w-0">
      <div className="label mb-1 flex items-center gap-1">
        {icon}
        {label}:{" "}
        <span className={idx > 0 ? "text-ink" : "text-ink-subtle"}>
          {STEP_LABEL[current] ?? current}
        </span>
      </div>
      <div className="flex gap-1">
        {steps.slice(1).map((s, i) => (
          <div
            key={s}
            title={STEP_LABEL[s] ?? s}
            className={`h-1.5 flex-1 rounded-full ${i < idx ? "bg-brand" : "bg-[#E5E2F0]"}`}
          />
        ))}
      </div>
    </div>
  );
}

function OutreachRow({ c }: { c: OutreachContact }) {
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ") || "(sin nombre)";
  const s = c.state;
  return (
    <div className="card flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="lg:w-64 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold truncate">{fullName}</span>
          {c.fit_score != null && (
            <span className="badge bg-[#EEEDFE] text-brand">fit {c.fit_score}</span>
          )}
        </div>
        <div className="text-xs text-ink-muted truncate">
          {c.job_title || "—"}
          {c.company_name ? ` · ${c.company_name}` : ""}
        </div>
        <div className="flex items-center gap-2 mt-1">
          {c.linkedin_url && (
            <a
              href={c.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="text-ink-subtle hover:text-brand"
              title="LinkedIn"
            >
              <IconBrandLinkedin size={14} />
            </a>
          )}
          {c.email && (
            <span className="text-xs text-ink-subtle truncate" title={c.email}>
              {c.email}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
        <Stepper
          steps={LINKEDIN_STEPS}
          current={s.linkedin_step}
          label="LinkedIn"
          icon={<IconBrandLinkedin size={12} />}
        />
        <Stepper
          steps={EMAIL_STEPS}
          current={s.email_step}
          label="Email"
          icon={<IconMail size={12} />}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 lg:w-56 lg:justify-end">
        {s.replied && <span className="badge bg-success-bg text-success-fg">respondió</span>}
        {s.interested && <span className="badge bg-success-bg text-success-fg">interesado</span>}
        {s.bounced && <span className="badge bg-danger-bg text-danger-fg">bounce</span>}
        {s.unsubscribed && (
          <span className="badge bg-warning-bg text-warning-fg">unsubscribe</span>
        )}
        {s.activity_count === 0 && (
          <span className="badge bg-[#F1EEF7] text-ink-muted">sin actividad</span>
        )}
        {c.hubspot_contact_id && (
          <span className="badge bg-[#EEEDFE] text-brand flex items-center gap-0.5">
            HubSpot <IconExternalLink size={10} />
          </span>
        )}
        {s.last_activity_at && (
          <span className="text-[11px] text-ink-subtle w-full lg:text-right">
            últ. actividad{" "}
            {new Date(s.last_activity_at).toLocaleDateString("es", {
              day: "2-digit",
              month: "short"
            })}
          </span>
        )}
      </div>
    </div>
  );
}
