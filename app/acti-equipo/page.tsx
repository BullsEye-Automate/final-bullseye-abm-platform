"use client";

import { useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import EquipoFacturacion from "@/components/acti/EquipoFacturacion";
import {
  isTrialPlan,
  monthlyCompanyQuota,
  PLAN_IDS,
  PULSO_VIEW_OPTIONS,
  STATUS_LABEL,
  type ActiConfig,
  type ActiPlan,
  type ActiPlanId,
  type ActiStatus,
} from "@/lib/acti/plans";

// ACTI · Red de Negocios — vista del equipo BullsEye: socios y
// configuración editable de los planes (solo PLAN_EDITORS guardan).

type Member = {
  client_id: string;
  client_name: string;
  plan: ActiPlanId;
  status: ActiStatus;
  joined_at: string;
  trial_start: string | null;
  trial_end: string | null;
  kam_email: string | null;
};

export default function ActiEquipoPage() {
  const [tab, setTab] = useState<"socios" | "planes" | "facturacion">("socios");
  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold text-ink">ACTI · Red de Negocios</h1>
      <p className="text-sm text-ink-muted mt-1 mb-5">
        Socios ACTI y planes. Un cliente se marca como socio en Configuración → Cliente → Socio ACTI (o al crearlo).
      </p>
      <div className="flex gap-2 mb-5">
        {(["socios", "planes", "facturacion"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? "btn-primary" : "btn-secondary"}>
            {t === "socios" ? "Socios" : t === "planes" ? "Planes y parámetros" : "Facturación"}
          </button>
        ))}
      </div>
      {tab === "socios" ? <Socios /> : tab === "planes" ? <Planes /> : <EquipoFacturacion />}
    </div>
  );
}

function Socios() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [ready, setReady] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/acti-equipo/members")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return setError(j.error);
        setReady(j.ready !== false);
        setMembers((j.members ?? []).sort((a: Member, b: Member) => a.client_name.localeCompare(b.client_name)));
      })
      .catch(() => setError("No se pudo cargar"));
  }, []);

  if (error) return <div className="card text-danger-fg">{error}</div>;
  if (!members) return <div className="card flex items-center gap-2 text-ink-muted"><IconLoader2 size={16} className="animate-spin" /> Cargando…</div>;
  if (!ready) return <div className="card text-sm">Falta correr la migración <code>supabase/20261127_acti_fase1_migration.sql</code>.</div>;

  const byPlan = PLAN_IDS.map((p) => ({ p, n: members.filter((m) => m.plan === p && m.status !== "baja").length }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {byPlan.map(({ p, n }) => (
          <div key={p} className="card">
            <div className="label">{p}</div>
            <div className="text-2xl font-bold text-ink">{n}</div>
          </div>
        ))}
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-muted border-b border-[#E5E2F0]">
              <th className="p-3">Socio</th><th className="p-3">Plan</th><th className="p-3">Estado</th>
              <th className="p-3">Alta</th><th className="p-3">Prueba</th><th className="p-3">KAM</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-ink-muted">Aún no hay socios ACTI.</td></tr>
            )}
            {members.map((m) => (
              <tr key={m.client_id} className="border-b border-[#F0EEF6] last:border-0">
                <td className="p-3 font-medium text-ink">{m.client_name}</td>
                <td className="p-3 capitalize">{m.plan}</td>
                <td className="p-3">{STATUS_LABEL[m.status] ?? m.status}</td>
                <td className="p-3">{m.joined_at}</td>
                <td className="p-3">{m.plan === "freemium" ? `${m.trial_start ?? m.joined_at} → ${m.trial_end ?? "+90 días"}` : "—"}</td>
                <td className="p-3">{m.kam_email ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type NumKey = "baseUf" | "perMeetingUf" | "guaranteedMeetings" | "trialMeetings" | "trialCompanies" | "trialDays" | "priority";
const NUM_ROWS: { key: NumKey; label: string; step?: string }[] = [
  { key: "baseUf", label: "Base mensual (UF)", step: "0.1" },
  { key: "perMeetingUf", label: "Variable por reunión (UF)", step: "0.1" },
  { key: "guaranteedMeetings", label: "Reuniones garantizadas al mes" },
  { key: "trialMeetings", label: "Prueba: reuniones" },
  { key: "trialCompanies", label: "Prueba: empresas" },
  { key: "trialDays", label: "Prueba: días" },
  { key: "priority", label: "Prioridad en la cola (mayor = antes)" },
];

function Planes() {
  const [config, setConfig] = useState<ActiConfig | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/acti-equipo/config")
      .then((r) => r.json())
      .then((j) => { setConfig(j.config ?? null); setCanEdit(!!j.canEdit); })
      .catch(() => setMsg({ ok: false, text: "No se pudo cargar" }));
  }, []);

  if (!config) return <div className="card flex items-center gap-2 text-ink-muted"><IconLoader2 size={16} className="animate-spin" /> Cargando…</div>;

  const setPlan = (id: ActiPlanId, patch: Partial<ActiPlan>) =>
    setConfig({ ...config, plans: { ...config.plans, [id]: { ...config.plans[id], ...patch } } });

  async function save() {
    setSaving(true);
    setMsg(null);
    const r = await fetch("/api/acti-equipo/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    const j = await r.json().catch(() => ({}));
    setSaving(false);
    if (r.ok) setConfig(j.config);
    setMsg(r.ok ? { ok: true, text: "Planes guardados. Los límites cambian al instante para los socios." } : { ok: false, text: j.error ?? "No se pudo guardar" });
  }

  const p = config.params;
  return (
    <div className="space-y-4">
      {!canEdit && (
        <div className="card text-sm text-ink-muted">Solo lectura: los planes los editan Adolfo, Ingri y jkarmy@.</div>
      )}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-muted border-b border-[#E5E2F0]">
              <th className="p-3">Campo</th>
              {PLAN_IDS.map((id) => <th key={id} className="p-3">{config.plans[id].name}</th>)}
            </tr>
          </thead>
          <tbody>
            {NUM_ROWS.map((row) => (
              <tr key={row.key} className="border-b border-[#F0EEF6]">
                <td className="p-3 text-ink-muted">{row.label}</td>
                {PLAN_IDS.map((id) => (
                  <td key={id} className="p-2">
                    <input
                      type="number" min={0} step={row.step ?? "1"} disabled={!canEdit}
                      className="input w-24"
                      value={config.plans[id][row.key]}
                      onChange={(e) => setPlan(id, { [row.key]: Number(e.target.value) } as Partial<ActiPlan>)}
                    />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-b border-[#F0EEF6]">
              <td className="p-3 text-ink-muted">Empresas al mes<div className="text-[11px]">Vacío = reuniones ÷ conversión</div></td>
              {PLAN_IDS.map((id) => {
                const plan = config.plans[id];
                return (
                  <td key={id} className="p-2">
                    <input
                      type="number" min={0} disabled={!canEdit || isTrialPlan(plan)} className="input w-24"
                      placeholder={String(monthlyCompanyQuota({ ...plan, companiesPerMonth: null }, p))}
                      value={plan.companiesPerMonth ?? ""}
                      onChange={(e) => setPlan(id, { companiesPerMonth: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </td>
                );
              })}
            </tr>
            {([["replacesNoResponse", "Reemplaza cuentas sin respuesta"], ["hasKam", "KAM asignado"], ["pulsoShowContacts", "Pulso con nombres de contactos"]] as const).map(([key, label]) => (
              <tr key={key} className="border-b border-[#F0EEF6]">
                <td className="p-3 text-ink-muted">{label}</td>
                {PLAN_IDS.map((id) => (
                  <td key={id} className="p-3">
                    <input type="checkbox" disabled={!canEdit} checked={config.plans[id][key]}
                      onChange={(e) => setPlan(id, { [key]: e.target.checked } as Partial<ActiPlan>)} />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="p-3 text-ink-muted align-top">Vistas de Pulso ABM</td>
              {PLAN_IDS.map((id) => (
                <td key={id} className="p-3 align-top">
                  {PULSO_VIEW_OPTIONS.map((v) => (
                    <label key={v.slug} className="flex items-center gap-1.5 text-xs py-0.5">
                      <input
                        type="checkbox" disabled={!canEdit}
                        checked={config.plans[id].pulsoViews.includes(v.slug)}
                        onChange={(e) => {
                          const cur = config.plans[id].pulsoViews;
                          setPlan(id, { pulsoViews: e.target.checked ? [...cur, v.slug] : cur.filter((s) => s !== v.slug) });
                        }}
                      />
                      {v.label}
                    </label>
                  ))}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Param label="Conversión de referencia (%)" value={Math.round(p.conversionRate * 1000) / 10} disabled={!canEdit}
          onChange={(v) => setConfig({ ...config, params: { ...p, conversionRate: v / 100 } })} />
        <Param label="Intentos para «sin respuesta»" value={p.noResponseAttempts} disabled={!canEdit}
          onChange={(v) => setConfig({ ...config, params: { ...p, noResponseAttempts: v } })} />
        <Param label="… en días hábiles" value={p.noResponseBusinessDays} disabled={!canEdit}
          onChange={(v) => setConfig({ ...config, params: { ...p, noResponseBusinessDays: v } })} />
        <Param label="Revenue share ACTI (% de la base)" value={p.revenueSharePct} disabled={!canEdit}
          onChange={(v) => setConfig({ ...config, params: { ...p, revenueSharePct: v } })} />
        <Param label="IVA (%)" value={p.ivaPct} disabled={!canEdit}
          onChange={(v) => setConfig({ ...config, params: { ...p, ivaPct: v } })} />
        <div>
          <label className="label block mb-1">Variable se cobra por reunión</label>
          <select className="input" disabled={!canEdit} value={p.chargeVariableOn}
            onChange={(e) => setConfig({ ...config, params: { ...p, chargeVariableOn: e.target.value as "realizada" | "agendada" } })}>
            <option value="realizada">Realizada (no-shows sin cargo)</option>
            <option value="agendada">Agendada</option>
          </select>
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar planes"}</button>
          {msg && <span className={`text-sm ${msg.ok ? "text-success-fg" : "text-danger-fg"}`}>{msg.text}</span>}
        </div>
      )}
      {!canEdit && msg && <span className="text-sm text-danger-fg">{msg.text}</span>}
    </div>
  );
}

function Param({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="label block mb-1">{label}</label>
      <input type="number" min={0} step="0.1" className="input" disabled={disabled} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
