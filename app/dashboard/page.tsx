"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowRight,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import { useClient, ALL_CLIENTS } from "@/lib/clientContext";
import type {
  AllClientsDashboard,
  ClientCard,
  ClientDashboard,
  LemlistErrorItem,
  MonthPoint,
  ProspectingKpis,
} from "@/lib/prospectingDashboard";

// Dashboard de prospección: la nueva forma de trabajar con la wishlist
// (recomendamos → el cliente aprueba → búsqueda automática de contactos →
// búsqueda manual cuando hay pocos). Con un cliente elegido muestra su
// reporte; con "Todos los clientes", una tarjeta de estado por cliente.

const RANGES = [
  ["this_week", "Esta semana"],
  ["last_week", "Semana pasada"],
  ["this_month", "Este mes"],
  ["last_month", "Mes pasado"],
  ["this_quarter", "Este trimestre"],
  ["this_year", "Este año"],
] as const;

type Data = (ClientDashboard | AllClientsDashboard) & { range: { key: string; label: string } };

const n = (v: number) => v.toLocaleString("es-CL");
const dec = (v: number | null) => (v == null ? "—" : v.toLocaleString("es-CL", { maximumFractionDigits: 1 }));
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export default function DashboardPage() {
  const { currentClient, setCurrentClient, clients } = useClient();
  const [range, setRange] = useState<string>("this_month");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientId = currentClient && currentClient.id !== ALL_CLIENTS.id ? currentClient.id : null;

  const load = useCallback(async () => {
    if (!currentClient) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/dashboard?range=${range}&client_id=${clientId ?? "__all__"}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Error al cargar");
      setData(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [currentClient, clientId, range]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const openClient = (id: string) => {
    const c = clients.find((x) => x.id === id);
    if (c) setCurrentClient(c);
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">Prospección</div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard de prospección</h1>
          <p className="text-sm text-ink-muted mt-1">
            {clientId
              ? `Empresas recomendadas, aprobadas y prospectadas para ${currentClient?.name}.`
              : "Estado de la prospección de cada cliente. Elige un cliente en el menú para ver su detalle."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={range} onChange={(e) => setRange(e.target.value)} className="btn-secondary py-1.5 text-sm">
            {RANGES.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <button onClick={load} disabled={loading} className="btn-secondary py-1.5 px-2.5" title="Actualizar">
            {loading ? <IconLoader2 size={16} className="animate-spin" /> : <IconRefresh size={16} />}
          </button>
        </div>
      </header>

      {error && (
        <div className="card flex items-center gap-2 text-sm text-danger-fg bg-danger-bg">
          <IconAlertCircle size={16} /> {error}
        </div>
      )}
      {data?.migration_missing && (
        <div className="card flex items-center gap-2 text-sm text-warning-fg bg-warning-bg">
          <IconAlertTriangle size={16} className="shrink-0" />
          Falta aplicar la migración <code>supabase/20261030_prospeccion_v3_migration.sql</code>: los contactos manuales y el estado de la búsqueda manual aún no se registran.
        </div>
      )}
      {!data && !error && <IconLoader2 className="animate-spin text-ink-muted" />}

      {data?.mode === "client" && <ClientReport data={data} onChanged={load} />}
      {data?.mode === "all" && <AllClientsReport data={data} onOpen={openClient} />}
    </div>
  );
}

// ── Piezas ───────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "bad" }) {
  const color = tone === "bad" ? "#993C1D" : tone === "warn" ? "#854F0B" : undefined;
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="text-3xl font-bold mt-1" style={{ color: color ?? "#1A1733" }}>{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 mt-2">
      <h2 className="font-semibold">{children}</h2>
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </div>
  );
}

function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="card space-y-2.5">
      <h2 className="font-semibold mb-2">Embudo del período</h2>
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-44 text-xs text-ink-muted text-right shrink-0">{s.label}</div>
            <div className="flex-1 bg-gray-100 rounded-full h-6">
              <div
                className="h-6 rounded-full flex items-center px-2.5"
                style={{ width: `${(s.value / max) * 100}%`, minWidth: s.value > 0 ? "2.25rem" : 0, background: i === 0 ? "#251762" : "#62E0D8" }}
              >
                {s.value > 0 && <span className="text-[11px] font-semibold" style={{ color: i === 0 ? "#fff" : "#251762" }}>{n(s.value)}</span>}
              </div>
            </div>
            <div className="w-12 text-xs text-ink-muted text-right shrink-0">{prev ? pct((s.value / prev) * 100) : ""}</div>
          </div>
        );
      })}
    </div>
  );
}

function Evolution({ months }: { months: MonthPoint[] }) {
  const series = [
    { key: "proposed", label: "Propuestas", color: "#251762" },
    { key: "approved", label: "Aprobadas", color: "#7F77DD" },
    { key: "prospected", label: "Prospectadas", color: "#62E0D8" },
  ] as const;
  const max = Math.max(...months.flatMap((m) => series.map((s) => m[s.key])), 1);
  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="font-semibold">Evolución (últimos 6 meses)</h2>
        <div className="flex gap-3 text-xs text-ink-muted">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-6 gap-3 items-end h-40">
        {months.map((m) => (
          <div key={m.month} className="flex items-end justify-center gap-1 h-full">
            {series.map((s) => (
              <div
                key={s.key}
                title={`${s.label}: ${m[s.key]}`}
                className="w-3 rounded-t"
                style={{ height: `${(m[s.key] / max) * 100}%`, minHeight: m[s.key] ? 3 : 0, background: s.color }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-6 gap-3 mt-2 text-center text-[11px] text-ink-muted">
        {months.map((m) => (
          <div key={m.month}>
            <div className="font-medium text-ink">{MONTHS[Number(m.month.slice(5)) - 1]}</div>
            <div>{n(m.auto_contacts)} auto · {n(m.manual_contacts)} man.</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Reporte de un cliente ────────────────────────────────────────────────

function ClientReport({ data, onChanged }: { data: ClientDashboard & { range: { label: string } }; onChanged: () => void }) {
  const k = data.kpis;
  return (
    <div className="space-y-4">
      <SectionTitle hint={data.range.label}>Empresas</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Recomendadas por IA" value={n(k.recommended_ai)} sub="fit ≥ 60%" />
        <Kpi label="Propuestas al cliente" value={n(k.proposed)} />
        <Kpi label="Aprobadas por el cliente" value={n(k.approved)} sub={`Tasa de aprobación ${pct(k.approval_rate)}`} />
        <Kpi label="Rechazadas" value={n(k.rejected)} />
        <Kpi label="Pedidas por el cliente" value={n(k.client_requested)} sub="desde su portal" />
      </div>

      <SectionTitle hint={data.range.label}>Prospección de contactos</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Empresas prospectadas" value={n(k.prospected)} sub={`${n(k.prospected_ok)} con contactos suficientes · ${n(k.prospected_few)} con pocos`} />
        <Kpi label="Contactos automáticos" value={n(k.auto_contacts)} sub={`Promedio ${dec(k.avg_auto_per_company)} por empresa`} />
        <Kpi label="Contactos manuales" value={n(k.manual_contacts)} sub="sumados en Búsqueda manual" />
        <Kpi
          label="Contactos aprobados"
          value={n(k.contacts_approved)}
          sub={`${n(k.contacts_with_email)} con email · ${n(k.contacts_with_phone)} con teléfono`}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Funnel
          steps={[
            { label: "Propuestas al cliente", value: k.proposed },
            { label: "Aprobadas", value: k.approved },
            { label: "Prospectadas", value: k.prospected },
            { label: "Con contactos suficientes", value: k.prospected_ok },
          ]}
        />
        <Evolution months={data.months} />
      </div>

      <SectionTitle hint="estado actual">Pendientes</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Esperando aprobación"
          value={n(k.pending_approval)}
          sub={k.pending_approval_oldest_days != null ? `la más antigua hace ${k.pending_approval_oldest_days} días` : "sin propuestas pendientes"}
          tone={k.pending_approval_oldest_days != null && k.pending_approval_oldest_days > 7 ? "warn" : undefined}
        />
        <Kpi label="Por prospectar" value={n(k.pending_prospecting)} sub={`de ${n(k.total_active)} aprobadas · búsqueda automática`} />
        <Link href="/busqueda-manual" className="block">
          <Kpi label="En búsqueda manual" value={n(k.manual_queue)} sub="pocos contactos → LinkedIn ›" tone={k.manual_queue ? "warn" : undefined} />
        </Link>
        <Kpi label="Sin enviar a Lemlist" value={n(k.lemlist_errors)} sub="no se prospectan hasta reintentar" tone={k.lemlist_errors ? "bad" : undefined} />
      </div>

      {data.lemlist_errors.length > 0 && <LemlistErrors items={data.lemlist_errors} onChanged={onChanged} />}
    </div>
  );
}

function LemlistErrors({ items, onChanged }: { items: LemlistErrorItem[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  async function retry(id: string) {
    setBusy(id);
    const r = await fetch(`/api/portal-admin/wishlist/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "push_lemlist" }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (r.ok) onChanged();
    else setMsg((m) => ({ ...m, [id]: j.error ?? "Error" }));
  }
  return (
    <div className="card">
      <h2 className="font-semibold mb-1">Empresas aprobadas que no llegaron al Lemlist del cliente</h2>
      <p className="text-xs text-ink-muted mb-3">Sin Lemlist no se buscan contactos. Revisa la API key en Config. cliente y reintenta.</p>
      <div className="divide-y divide-gray-100">
        {items.map((it) => (
          <div key={it.id} className="py-2 flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium truncate">{it.company_name}</div>
              <div className="text-xs text-danger-fg truncate">{msg[it.id] ?? it.error ?? "Error"}</div>
            </div>
            <button onClick={() => retry(it.id)} disabled={busy === it.id} className="btn-secondary py-1 px-3 text-xs shrink-0">
              {busy === it.id ? <IconLoader2 size={13} className="animate-spin" /> : "Reintentar"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Todos los clientes ───────────────────────────────────────────────────

function AllClientsReport({ data, onOpen }: { data: AllClientsDashboard & { range: { label: string } }; onOpen: (id: string) => void }) {
  const t = data.totals;
  return (
    <div className="space-y-4">
      <SectionTitle hint={`${data.range.label} · todos los clientes`}>Resumen general</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Kpi label="Propuestas" value={n(t.proposed)} />
        <Kpi label="Aprobadas" value={n(t.approved)} sub={`Tasa ${pct(t.approval_rate)}`} />
        <Kpi label="Prospectadas" value={n(t.prospected)} />
        <Kpi label="Contactos auto" value={n(t.auto_contacts)} sub={`Prom. ${dec(t.avg_auto_per_company)} / empresa`} />
        <Kpi label="Contactos manuales" value={n(t.manual_contacts)} />
        <Kpi label="Esperando aprobación" value={n(t.pending_approval)} sub={`${n(t.manual_queue)} en búsqueda manual`} />
      </div>

      <SectionTitle hint="clic en una tarjeta para ver el detalle del cliente">Por cliente</SectionTitle>
      {data.clients.length === 0 && <div className="text-sm text-ink-muted">Ningún cliente tiene empresas en la wishlist todavía.</div>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {data.clients.map((c) => (
          <ClientStatusCard key={c.client_id} card={c} onOpen={() => onOpen(c.client_id)} />
        ))}
      </div>
    </div>
  );
}

function ClientStatusCard({ card, onOpen }: { card: ClientCard; onOpen: () => void }) {
  const k: ProspectingKpis = card.kpis;
  const rows: [string, string][] = [
    ["Propuestas / aprobadas", `${n(k.proposed)} / ${n(k.approved)}`],
    ["Contactos auto (prom.)", `${n(k.auto_contacts)} (${dec(k.avg_auto_per_company)})`],
    ["Contactos manuales", n(k.manual_contacts)],
  ];
  const pending: { label: string; value: number; tone: string }[] = [
    { label: "esperando aprobación", value: k.pending_approval, tone: "#854F0B" },
    { label: "por prospectar", value: k.pending_prospecting, tone: "#185FA5" },
    { label: "búsqueda manual", value: k.manual_queue, tone: "#854F0B" },
    { label: "sin Lemlist", value: k.lemlist_errors, tone: "#993C1D" },
  ].filter((p) => p.value > 0);

  return (
    <button onClick={onOpen} className="card text-left transition hover:ring-2 hover:ring-[#62E0D8] group">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold truncate">{card.client_name}</div>
        <IconArrowRight size={16} className="text-ink-subtle group-hover:text-brand shrink-0" />
      </div>
      <div className="flex items-baseline gap-2 mt-2">
        <span className="text-3xl font-bold">{n(k.prospected)}</span>
        <span className="text-xs text-ink-muted">empresas prospectadas</span>
      </div>
      <div className="mt-3 space-y-1 text-xs">
        {rows.map(([l, v]) => (
          <div key={l} className="flex justify-between gap-2">
            <span className="text-ink-muted">{l}</span>
            <span className="font-medium">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {pending.length === 0 ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-success-bg text-success-fg">Al día</span>
        ) : (
          pending.map((p) => (
            <span key={p.label} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100" style={{ color: p.tone }}>
              {n(p.value)} {p.label}
            </span>
          ))
        )}
      </div>
      {card.last_activity && (
        <div className="text-[11px] text-ink-subtle mt-3">
          Último movimiento {new Date(card.last_activity).toLocaleDateString("es-CL", { day: "numeric", month: "short" })}
        </div>
      )}
    </button>
  );
}
