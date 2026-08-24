"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconPhone,
  IconUsers,
  IconBuilding,
  IconPhoneCheck,
  IconCalendarEvent,
  IconLoader2,
  IconAlertCircle,
  IconRefresh,
  IconX,
  IconExternalLink,
  IconTag,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";
import { RangeKey, RANGE_LABELS } from "@/lib/dashboardRanges";

// ─── Tipos ──────────────────────────────────────────────────────────────────

type SdrRef = { id: string; name: string; email: string };
type AlloTag = { id: string; name: string; color: string | null };
type CallResult = "ANSWERED" | "VOICEMAIL" | "TRANSFERRED";

type CallItem = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  allo_number: string;
  contact_number: string;
  user: SdrRef | null;
  date: string;
  duration: number;
  result: CallResult | null;
  recording_url: string | null;
  summary: string | null;
  tags: string[];
  contact_name: string | null;
  contact_job_title: string | null;
  contact_company: string | null;
  hubspot_contact_id: string | null;
};

type CallDetail = CallItem & {
  transcript: { speaker: string; text: string; timestamp?: number }[] | null;
};

type Stats = {
  llamadas_realizadas: number;
  conectados: number;
  reuniones_agendadas: number;
  contactos: number;
  empresas: number;
};

type AlloNumberRef = { allo_number: string; allo_number_name: string | null };

type ApiResponse = {
  no_numbers: boolean;
  calls: CallItem[];
  sdrs: SdrRef[];
  tags: AlloTag[];
  numbers: AlloNumberRef[];
  stats: Stats;
  error?: string;
};

type StatKey = "llamadas" | "conectados" | "reuniones" | "contactos" | "empresas";

// ─── Helpers ────────────────────────────────────────────────────────────────

function isConnected(c: CallItem): boolean {
  return c.result === "ANSWERED" || c.result === "TRANSFERRED";
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RESULT_META: Record<CallResult, { label: string; bg: string; fg: string }> = {
  ANSWERED: { label: "Contestada", bg: "#E1F5EE", fg: "#0F6E56" },
  TRANSFERRED: { label: "Transferida", bg: "#E6F1FB", fg: "#185FA5" },
  VOICEMAIL: { label: "Buzón de voz", bg: "#F4F2FB", fg: "#6B6884" },
};

function dedupeContacts(calls: CallItem[]) {
  const map = new Map<
    string,
    { contact_number: string; contact_name: string | null; contact_job_title: string | null; contact_company: string | null; call_count: number; last_date: string }
  >();
  for (const c of calls) {
    const existing = map.get(c.contact_number);
    if (!existing) {
      map.set(c.contact_number, {
        contact_number: c.contact_number,
        contact_name: c.contact_name,
        contact_job_title: c.contact_job_title,
        contact_company: c.contact_company,
        call_count: 1,
        last_date: c.date,
      });
    } else {
      existing.call_count += 1;
      existing.contact_name = existing.contact_name || c.contact_name;
      existing.contact_job_title = existing.contact_job_title || c.contact_job_title;
      existing.contact_company = existing.contact_company || c.contact_company;
      if (c.date > existing.last_date) existing.last_date = c.date;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.last_date.localeCompare(a.last_date));
}

function dedupeCompanies(calls: CallItem[]) {
  const map = new Map<string, { company: string; call_count: number; contacts: Set<string> }>();
  for (const c of calls) {
    if (!c.contact_company) continue;
    const key = c.contact_company.trim().toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { company: c.contact_company.trim(), call_count: 1, contacts: new Set([c.contact_number]) });
    } else {
      existing.call_count += 1;
      existing.contacts.add(c.contact_number);
    }
  }
  return Array.from(map.values())
    .map((v) => ({ company: v.company, call_count: v.call_count, contact_count: v.contacts.size }))
    .sort((a, b) => b.call_count - a.call_count);
}

// ─── Sub-componentes ────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={value === 0}
      className="card py-3 px-4 flex flex-col gap-1 text-left border border-transparent hover:border-brand-soft transition-colors disabled:cursor-default"
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-ink-muted uppercase">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold" style={{ color: "#251762" }}>
        {value}
      </div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </button>
  );
}

function ResultBadge({ result }: { result: CallResult | null }) {
  if (!result) return <span className="text-xs text-ink-subtle">—</span>;
  const meta = RESULT_META[result];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: meta.bg, color: meta.fg }}
    >
      {meta.label}
    </span>
  );
}

function TagBadges({ tagIds, tags }: { tagIds: string[]; tags: AlloTag[] }) {
  if (tagIds.length === 0) return <span className="text-xs text-ink-subtle">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tagIds.map((id) => {
        const tag = tags.find((t) => t.id === id);
        const color = tag?.color ?? "#9794AC";
        return (
          <span
            key={id}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={{ background: `${color}1F`, color }}
          >
            {tag?.name ?? id}
          </span>
        );
      })}
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  maxWidth = "max-w-2xl",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className={`card w-full ${maxWidth} max-h-[85vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-white">
          <h2 className="font-semibold text-lg">{title}</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors">
            <IconX size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const STAT_TITLES: Record<StatKey, string> = {
  llamadas: "Llamadas realizadas",
  conectados: "Llamadas conectadas",
  reuniones: "Reuniones agendadas",
  contactos: "Contactos",
  empresas: "Empresas",
};

function CallsTable({
  calls,
  tags,
  onSelectCall,
}: {
  calls: CallItem[];
  tags: AlloTag[];
  onSelectCall: (id: string) => void;
}) {
  if (calls.length === 0) {
    return <p className="text-sm text-ink-muted py-6 text-center">Sin llamadas para este filtro.</p>;
  }
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead className="bg-[#F4F2FB]">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-ink-muted whitespace-nowrap">Fecha</th>
            <th className="px-3 py-2 text-left font-medium text-ink-muted whitespace-nowrap">SDR</th>
            <th className="px-3 py-2 text-left font-medium text-ink-muted">Contacto</th>
            <th className="px-3 py-2 text-left font-medium text-ink-muted">Cargo</th>
            <th className="px-3 py-2 text-left font-medium text-ink-muted">Empresa</th>
            <th className="px-3 py-2 text-left font-medium text-ink-muted whitespace-nowrap">Duración</th>
            <th className="px-3 py-2 text-left font-medium text-ink-muted whitespace-nowrap">Resultado</th>
            <th className="px-3 py-2 text-left font-medium text-ink-muted">Etiquetas</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr
              key={c.id}
              onClick={() => onSelectCall(c.id)}
              className="border-t border-[#E5E2F0] hover:bg-brand-tint cursor-pointer"
            >
              <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{formatDateTime(c.date)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{c.user?.name ?? "—"}</td>
              <td className="px-3 py-2">
                <div className="font-medium">{c.contact_name ?? "Sin identificar"}</div>
                <div className="text-xs text-ink-subtle font-mono">{c.contact_number}</div>
              </td>
              <td className="px-3 py-2 text-ink-muted">{c.contact_job_title ?? "—"}</td>
              <td className="px-3 py-2 text-ink-muted">{c.contact_company ?? "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{formatDuration(c.duration)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <ResultBadge result={c.result} />
              </td>
              <td className="px-3 py-2">
                <TagBadges tagIds={c.tags} tags={tags} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContactsTable({ calls }: { calls: CallItem[] }) {
  const rows = useMemo(() => dedupeContacts(calls), [calls]);
  if (rows.length === 0) {
    return <p className="text-sm text-ink-muted py-6 text-center">Sin contactos para este filtro.</p>;
  }
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead className="bg-[#F4F2FB]">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-ink-muted">Contacto</th>
            <th className="px-3 py-2 text-left font-medium text-ink-muted">Cargo</th>
            <th className="px-3 py-2 text-left font-medium text-ink-muted">Empresa</th>
            <th className="px-3 py-2 text-left font-medium text-ink-muted whitespace-nowrap">Llamadas</th>
            <th className="px-3 py-2 text-left font-medium text-ink-muted whitespace-nowrap">Última llamada</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.contact_number} className="border-t border-[#E5E2F0]">
              <td className="px-3 py-2">
                <div className="font-medium">{r.contact_name ?? "Sin identificar"}</div>
                <div className="text-xs text-ink-subtle font-mono">{r.contact_number}</div>
              </td>
              <td className="px-3 py-2 text-ink-muted">{r.contact_job_title ?? "—"}</td>
              <td className="px-3 py-2 text-ink-muted">{r.contact_company ?? "—"}</td>
              <td className="px-3 py-2">{r.call_count}</td>
              <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{formatDateTime(r.last_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompaniesTable({ calls }: { calls: CallItem[] }) {
  const rows = useMemo(() => dedupeCompanies(calls), [calls]);
  const unidentified = calls.length - rows.reduce((acc, r) => acc + r.call_count, 0);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted py-6 text-center">
        Ninguna llamada tiene empresa identificada en HubSpot todavía.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm">
          <thead className="bg-[#F4F2FB]">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-ink-muted">Empresa</th>
              <th className="px-3 py-2 text-left font-medium text-ink-muted whitespace-nowrap">Contactos</th>
              <th className="px-3 py-2 text-left font-medium text-ink-muted whitespace-nowrap">Llamadas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.company} className="border-t border-[#E5E2F0]">
                <td className="px-3 py-2 font-medium">{r.company}</td>
                <td className="px-3 py-2">{r.contact_count}</td>
                <td className="px-3 py-2">{r.call_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unidentified > 0 && (
        <p className="text-xs text-ink-subtle">
          {unidentified} llamada{unidentified !== 1 ? "s" : ""} sin empresa identificada en HubSpot (no aparecen arriba).
        </p>
      )}
    </div>
  );
}

function CallDetailModal({
  callId,
  tags,
  onClose,
}: {
  callId: string;
  tags: AlloTag[];
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setDetail(null);
    fetch(`/api/allo/calls/${callId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setDetail(d.call);
      })
      .catch((e) => setError(e.message ?? "Error de red"))
      .finally(() => setLoading(false));
  }, [callId]);

  return (
    <ModalShell title="Detalle de la llamada" onClose={onClose} maxWidth="max-w-3xl">
      {loading && (
        <div className="flex items-center gap-2 text-ink-muted py-10 justify-center">
          <IconLoader2 size={20} className="animate-spin" /> Cargando desde Allo…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-danger-fg text-sm py-4">
          <IconAlertCircle size={16} /> {error}
        </div>
      )}
      {detail && !loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="label mb-0.5">Contacto</div>
              <div className="font-medium">{detail.contact_name ?? "Sin identificar"}</div>
              <div className="text-xs text-ink-subtle font-mono">{detail.contact_number}</div>
            </div>
            <div>
              <div className="label mb-0.5">Empresa / cargo</div>
              <div>{detail.contact_company ?? "—"}</div>
              <div className="text-xs text-ink-muted">{detail.contact_job_title ?? ""}</div>
            </div>
            <div>
              <div className="label mb-0.5">SDR</div>
              <div>{detail.user?.name ?? "—"}</div>
            </div>
            <div>
              <div className="label mb-0.5">Fecha</div>
              <div>{formatDateTime(detail.date)} · {formatDuration(detail.duration)}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ResultBadge result={detail.result} />
            <TagBadges tagIds={detail.tags} tags={tags} />
          </div>

          {detail.recording_url && (
            <audio controls className="w-full" src={detail.recording_url}>
              Tu navegador no soporta audio.
            </audio>
          )}

          {detail.summary && (
            <div>
              <div className="label mb-1">Resumen</div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{detail.summary}</p>
            </div>
          )}

          <div>
            <div className="label mb-1">Transcripción</div>
            {detail.transcript && detail.transcript.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto bg-[#F4F2FB] rounded-lg p-3">
                {detail.transcript.map((t, i) => (
                  <p key={i} className="text-sm">
                    <span className="font-medium">{t.speaker || "—"}:</span> {t.text}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-muted">No hay transcripción disponible para esta llamada.</p>
            )}
          </div>

          {detail.hubspot_contact_id && (
            <a
              href={`https://app.hubspot.com/contacts/${detail.hubspot_contact_id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
            >
              Ver contacto en HubSpot <IconExternalLink size={12} />
            </a>
          )}
        </div>
      )}
    </ModalShell>
  );
}

// ─── Página principal ───────────────────────────────────────────────────────

export default function LlamadasPage() {
  const { currentClient } = useClient();

  const [rangeKey, setRangeKey] = useState<RangeKey>("this_month");
  const [numberFilter, setNumberFilter] = useState<string>("");
  const [sdrFilter, setSdrFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statModal, setStatModal] = useState<StatKey | null>(null);
  const [callModalId, setCallModalId] = useState<string | null>(null);

  function load(clientId: string) {
    setLoading(true);
    setError(null);
    fetch(`/api/clients/${clientId}/allo-calls?range=${rangeKey}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ApiResponse) => {
        if (d.error) { setError(d.error); setData(null); return; }
        setData(d);
        setSdrFilter("");
        setNumberFilter("");
      })
      .catch((e) => setError(e.message ?? "Error de red"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (currentClient?.id) load(currentClient.id);
    else setData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient?.id, rangeKey]);

  const filteredCalls = useMemo(() => {
    let calls = data?.calls ?? [];
    if (numberFilter) calls = calls.filter((c) => c.allo_number === numberFilter);
    if (sdrFilter) calls = calls.filter((c) => c.user?.id === sdrFilter);
    return calls;
  }, [data, numberFilter, sdrFilter]);

  const stats: Stats = useMemo(
    () => ({
      llamadas_realizadas: filteredCalls.length,
      conectados: filteredCalls.filter(isConnected).length,
      reuniones_agendadas: filteredCalls.filter((c) => c.tags.includes("meeting_booked")).length,
      contactos: new Set(filteredCalls.map((c) => c.contact_number)).size,
      empresas: new Set(
        filteredCalls.map((c) => c.contact_company).filter((c): c is string => !!c).map((c) => c.trim().toLowerCase())
      ).size,
    }),
    [filteredCalls]
  );

  const availableTagIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of filteredCalls) for (const t of c.tags) ids.add(t);
    return ids;
  }, [filteredCalls]);

  const listCalls = useMemo(() => {
    const filtered = tagFilter ? filteredCalls.filter((c) => c.tags.includes(tagFilter)) : filteredCalls;
    return [...filtered].sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredCalls, tagFilter]);

  const statModalCalls = useMemo(() => {
    switch (statModal) {
      case "llamadas": return filteredCalls;
      case "conectados": return filteredCalls.filter(isConnected);
      case "reuniones": return filteredCalls.filter((c) => c.tags.includes("meeting_booked"));
      default: return filteredCalls;
    }
  }, [statModal, filteredCalls]);

  const tags = data?.tags ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label">SDR</div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <IconPhone size={24} />
            Llamadas
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Reportería en vivo desde Allo, filtrada por los números asignados a este cliente.
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

          {(data?.numbers.length ?? 0) > 1 && (
            <select
              className="input py-1.5 text-sm"
              value={numberFilter}
              onChange={(e) => setNumberFilter(e.target.value)}
            >
              <option value="">Todos los números</option>
              {(data?.numbers ?? []).map((n) => (
                <option key={n.allo_number} value={n.allo_number}>
                  {n.allo_number_name || n.allo_number}
                </option>
              ))}
            </select>
          )}

          <select
            className="input py-1.5 text-sm"
            value={sdrFilter}
            onChange={(e) => setSdrFilter(e.target.value)}
            disabled={!data || data.sdrs.length === 0}
          >
            <option value="">Todos los SDR</option>
            {(data?.sdrs ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
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

      {!currentClient && (
        <div className="card text-ink-muted text-sm">
          Selecciona un cliente en el sidebar para ver su reportería de llamadas.
        </div>
      )}

      {error && (
        <div className="card border border-danger-bg text-danger-fg flex items-center gap-2 text-sm">
          <IconAlertCircle size={16} /> {error}
        </div>
      )}

      {currentClient && data?.no_numbers && (
        <div className="card flex items-center gap-3 text-warning-fg border border-warning-bg bg-warning-bg/40 text-sm">
          <IconAlertCircle size={18} className="shrink-0" />
          Este cliente no tiene números de Allo asignados. Ve a Configuración → Cliente para asignarlos.
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-ink-muted py-10 justify-center">
          <IconLoader2 size={22} className="animate-spin" />
          <span>Cargando desde Allo…</span>
        </div>
      )}

      {!loading && data && !data.no_numbers && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-5 gap-3">
            <StatCard
              icon={<IconPhone size={13} />}
              label="Llamadas realizadas"
              value={stats.llamadas_realizadas}
              onClick={() => setStatModal("llamadas")}
            />
            <StatCard
              icon={<IconUsers size={13} />}
              label="Contactos"
              value={stats.contactos}
              onClick={() => setStatModal("contactos")}
            />
            <StatCard
              icon={<IconBuilding size={13} />}
              label="Empresas"
              value={stats.empresas}
              onClick={() => setStatModal("empresas")}
            />
            <StatCard
              icon={<IconPhoneCheck size={13} />}
              label="Conectados"
              value={stats.conectados}
              sub={stats.llamadas_realizadas > 0 ? `${Math.round((stats.conectados / stats.llamadas_realizadas) * 100)}% de conexión` : undefined}
              onClick={() => setStatModal("conectados")}
            />
            <StatCard
              icon={<IconCalendarEvent size={13} />}
              label="Reuniones agendadas"
              value={stats.reuniones_agendadas}
              onClick={() => setStatModal("reuniones")}
            />
          </div>

          {/* Filtro de etiquetas + listado */}
          <section className="card space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-semibold flex items-center gap-2">
                <IconPhone size={16} className="text-brand" /> Listado de llamadas
                <span className="text-xs font-normal text-ink-muted">({listCalls.length})</span>
              </h2>
              <div className="flex items-center gap-2">
                <IconTag size={15} className="text-ink-subtle" />
                <select
                  className="input py-1.5 text-sm"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                >
                  <option value="">Todas las etiquetas</option>
                  {tags.filter((t) => availableTagIds.has(t.id)).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <CallsTable calls={listCalls} tags={tags} onSelectCall={setCallModalId} />
          </section>
        </>
      )}

      {/* Popup de estadística */}
      {statModal && (
        <ModalShell title={STAT_TITLES[statModal]} onClose={() => setStatModal(null)} maxWidth="max-w-4xl">
          {statModal === "contactos" ? (
            <ContactsTable calls={statModalCalls} />
          ) : statModal === "empresas" ? (
            <CompaniesTable calls={statModalCalls} />
          ) : (
            <CallsTable
              calls={statModalCalls}
              tags={tags}
              onSelectCall={(id) => { setCallModalId(id); }}
            />
          )}
        </ModalShell>
      )}

      {/* Detalle de llamada */}
      {callModalId && (
        <CallDetailModal callId={callModalId} tags={tags} onClose={() => setCallModalId(null)} />
      )}
    </div>
  );
}
