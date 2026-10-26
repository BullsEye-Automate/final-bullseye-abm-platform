"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IconAlertCircle, IconCheck, IconDeviceFloppy, IconLoader2, IconRadar, IconRefresh } from "@tabler/icons-react";

// Radar ABM del cliente: de qué HubSpot se lee su universo, qué valor de
// "Cliente BullsEye" lo identifica y si el informe se ve en su portal.

type Settings = {
  hubspot_source: "bullseye" | "client";
  hubspot_client_value: string | null;
  deep: boolean | null;
  pipeline: boolean | null;
  portal_enabled: boolean;
};
type Option = { label: string; value: string };

const tri = (v: boolean | null) => (v === true ? "si" : v === false ? "no" : "auto");
const fromTri = (v: string) => (v === "si" ? true : v === "no" ? false : null);

export default function RadarSettings({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [s, setS] = useState<Settings | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [optErr, setOptErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    setS(null);
    setError(null);
    setOkMsg(null);
    setOptions(null);
    setOptErr(null);
    fetch(`/api/clients/${clientId}/radar`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setError(d.error);
        setS(d.settings);
        setSyncedAt(d.syncedAt);
        setStats(d.stats);
      })
      .catch((e) => setError(e.message));
  }, [clientId]);

  // Valores de "Cliente BullsEye" en el HubSpot de BullsEye
  useEffect(() => {
    if (!s || s.hubspot_source !== "bullseye" || options) return;
    fetch("/api/radar-abm/detect", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setOptErr(d.error);
        const p = (d.properties ?? []).find((x: { key: string }) => x.key === "companyClient");
        if (!p?.property) return setOptErr('No se encontró la propiedad "Cliente BullsEye" en HubSpot (Análisis → Radar ABM → Configuración).');
        setOptions(p.options ?? []);
      })
      .catch((e) => setOptErr(e.message));
  }, [s, options]);

  async function save(): Promise<boolean> {
    if (!s) return false;
    setBusy("save");
    setError(null);
    setOkMsg(null);
    const r = await fetch(`/api/clients/${clientId}/radar`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok || d.error) { setError(d.error ?? "No se pudo guardar"); return false; }
    setS(d.settings);
    setOkMsg("Guardado.");
    return true;
  }

  async function sync() {
    if (!(await save())) return;
    setBusy("sync");
    setOkMsg(null);
    const r = await fetch(`/api/radar-abm?client_id=${clientId}`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok || d.error) return setError(d.error ?? "No se pudo sincronizar");
    setSyncedAt(d.syncedAt);
    setStats(d.stats);
    setOkMsg(`Sincronizado: ${d.stats?.companies ?? 0} empresas, ${d.stats?.contacts ?? 0} contactos, ${d.stats?.meetings ?? 0} reuniones.`);
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-semibold flex items-center gap-2">
          <IconRadar size={18} className="text-brand" /> Radar ABM
        </h2>
        <p className="text-sm text-ink-muted mt-1">
          Informe ABM del cliente (cuentas, contactos, conversaciones, reuniones y oportunidades), leído de HubSpot una vez al día o con “Sincronizar ahora”.
          Es el informe que el cliente ve en su portal. Ver en <Link href="/analisis/radar-abm" className="text-brand hover:underline">Análisis → Radar ABM</Link>.
        </p>
      </div>

      {!s && !error ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted"><IconLoader2 size={14} className="animate-spin" /> Cargando…</div>
      ) : s ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="label block mb-1">HubSpot de origen</span>
            <select className="input" value={s.hubspot_source} onChange={(e) => setS({ ...s, hubspot_source: e.target.value as Settings["hubspot_source"] })}>
              <option value="bullseye">HubSpot de BullsEye</option>
              <option value="client">HubSpot propio del cliente</option>
            </select>
            <span className="text-xs text-ink-subtle block mt-1">
              {s.hubspot_source === "client"
                ? "Usa el token de “HubSpot del cliente” (arriba). Universo = empresas con “Status de la asignación - SDR”. El token debe poder leer empresas, contactos, actividades y negocios."
                : "Universo = empresas con este cliente en la propiedad “Cliente BullsEye”."}
            </span>
          </label>

          {s.hubspot_source === "bullseye" ? (
            <label className="text-sm">
              <span className="label block mb-1">Valor en “Cliente BullsEye”</span>
              {options && options.length ? (
                <select className="input" value={s.hubspot_client_value ?? ""} onChange={(e) => setS({ ...s, hubspot_client_value: e.target.value || null })}>
                  <option value="">Automático (por nombre: {clientName})</option>
                  {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input className="input" value={s.hubspot_client_value ?? ""} placeholder={`Automático (por nombre: ${clientName})`} onChange={(e) => setS({ ...s, hubspot_client_value: e.target.value || null })} />
              )}
              {optErr && <span className="text-xs text-danger-fg block mt-1">{optErr}</span>}
            </label>
          ) : <div />}

          <label className="text-sm">
            <span className="label block mb-1">Registra negocios (pipeline)</span>
            <select className="input" value={tri(s.pipeline)} onChange={(e) => setS({ ...s, pipeline: fromTri(e.target.value) })}>
              <option value="auto">Automático (si tiene negocios asociados)</option>
              <option value="si">Sí</option>
              <option value="no">No: “Sin información disponible”</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="label block mb-1">Tipo de cartera</span>
            <select className="input" value={tri(s.deep)} onChange={(e) => setS({ ...s, deep: fromTri(e.target.value) })}>
              <option value="auto">Automático (hasta 40 empresas = acotada)</option>
              <option value="si">Cuentas estratégicas acotadas (lectura de profundidad)</option>
              <option value="no">Universo amplio (cobertura + profundidad)</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={s.portal_enabled} onChange={(e) => setS({ ...s, portal_enabled: e.target.checked })} />
            Mostrar el Radar ABM en el portal del cliente
          </label>
        </div>
      ) : null}

      {s && (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={!!busy} className="btn-secondary">
            {busy === "save" ? <IconLoader2 size={15} className="animate-spin" /> : <IconDeviceFloppy size={15} />} Guardar
          </button>
          <button onClick={sync} disabled={!!busy} className="btn-primary">
            {busy === "sync" ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />} {busy === "sync" ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
          <span className="text-xs text-ink-muted">
            {syncedAt
              ? `Última sincronización: ${new Date(syncedAt).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}${stats ? ` · ${stats.companies ?? 0} empresas, ${stats.contacts ?? 0} contactos` : ""}`
              : "Sin sincronizar todavía: el portal muestra “informe en preparación”."}
          </span>
        </div>
      )}

      {okMsg && <div className="text-sm text-green-700 flex items-center gap-2"><IconCheck size={14} /> {okMsg}</div>}
      {error && <div className="text-sm text-danger-fg flex items-center gap-2"><IconAlertCircle size={14} /> {error}</div>}
    </section>
  );
}
