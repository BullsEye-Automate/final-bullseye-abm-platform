"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ClientHubspotRadar from "./ClientHubspotRadar";
import { IconAlertCircle, IconCheck, IconDeviceFloppy, IconLoader2, IconRadar, IconRefresh } from "@tabler/icons-react";

// Radar ABM del cliente: de qué HubSpot se lee su universo, qué valor de
// "Cliente BullsEye" lo identifica y si el informe se ve en su portal.

type Settings = {
  hubspot_source: "bullseye" | "client";
  hubspot_client_value: string | null;
  deep: boolean | null;
  pipeline: boolean | null;
  portal_enabled: boolean;
  properties: Record<string, string>;
};
type Option = { name: string; label: string };

// Propiedades que en el HubSpot de BullsEye existen una por cliente
const PER_CLIENT: [string, string, boolean][] = [
  ["companyStatus", "Status de empresa", true],
  ["contactStatus", "Status de contacto", true],
  ["companySdr", "SDR de la empresa", false],
  ["contactSdr", "SDR del contacto", false],
];

const tri = (v: boolean | null) => (v === true ? "si" : v === false ? "no" : "auto");
const fromTri = (v: string) => (v === "si" ? true : v === "no" ? false : null);

export default function RadarSettings({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [s, setS] = useState<Settings | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [master, setMaster] = useState<{ active: boolean; text: string } | null>(null);
  const [statusInfo, setStatusInfo] = useState<Record<string, { candidates: Option[]; auto: string | null }> | null>(null);
  const [optErr, setOptErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    setS(null);
    setError(null);
    setOkMsg(null);
    setStatusInfo(null);
    setOptErr(null);
    fetch(`/api/clients/${clientId}/radar`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setError(d.error);
        setS(d.settings);
        setSyncedAt(d.syncedAt);
        setStats(d.stats);
        setMaster(d.master ?? null);
      })
      .catch((e) => setError(e.message));
  }, [clientId]);

  // Propiedades por cliente del HubSpot de BullsEye ("Status de la
  // asignación - <cliente>", "Asignación BullsEye por llamar - <cliente>",
  // "SDR - <cliente>", "SDR Asignado - <cliente>") y la que se elige
  // automáticamente para este cliente
  useEffect(() => {
    if (!s || s.hubspot_source !== "bullseye" || statusInfo) return;
    fetch(`/api/radar-abm/detect?client_id=${clientId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setOptErr(d.error);
        const info: Record<string, { candidates: Option[]; auto: string | null }> = {};
        for (const p of d.properties ?? []) {
          if (PER_CLIENT.some(([k]) => k === p.key)) info[p.key] = { candidates: p.candidates ?? [], auto: p.manual ? null : p.propLabel };
        }
        if (!info.companyStatus?.candidates.length) setOptErr('No se encontraron propiedades "Status de la asignación - …" en el HubSpot de BullsEye.');
        setStatusInfo(info);
      })
      .catch((e) => setOptErr(e.message));
  }, [s, statusInfo, clientId]);

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

      {master && (
        <div className={`text-sm rounded-lg px-3 py-2 ${master.active ? "bg-success-bg text-success-fg" : "bg-warning-bg text-warning-fg"}`}>
          {master.text}{!master.active && " No se sincroniza ni se muestra en el portal mientras no esté activo en la Maestra (Maestra IA → Status Cliente)."}
        </div>
      )}

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
                ? "Usa el token de “HubSpot del cliente” (arriba). Universo = empresas con su propiedad “Status de la asignación - …” con algún valor."
                : "Universo = empresas con la propiedad “Status de la asignación - <cliente>” de este cliente con algún valor."}
            </span>
          </label>

          <div />

          {s.hubspot_source === "bullseye" && (
            <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
              {PER_CLIENT.map(([key, label, required]) => {
                const info = statusInfo?.[key];
                return (
                  <label key={key} className="text-sm">
                    <span className="label block mb-1">{label}{required && <span className="text-danger-fg"> *</span>}</span>
                    <select
                      className="input"
                      value={s.properties?.[key] ?? ""}
                      onChange={(e) => {
                        const { [key]: _old, ...rest } = s.properties ?? {};
                        setS({ ...s, properties: e.target.value ? { ...rest, [key]: e.target.value } : rest });
                      }}
                    >
                      <option value="">
                        Automático{info ? `: ${info.auto ?? (required ? "sin coincidencia, elige una" : "propietario del registro")}` : ""}
                      </option>
                      {(info?.candidates ?? []).map((o) => <option key={o.name} value={o.name}>{o.label}</option>)}
                    </select>
                  </label>
                );
              })}
              {optErr && <span className="text-xs text-danger-fg sm:col-span-2">{optErr}</span>}
            </div>
          )}

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

      {s?.hubspot_source === "client" && (
        <ClientHubspotRadar
          clientId={clientId}
          properties={s.properties ?? {}}
          onPropertiesChange={(properties) => setS({ ...s, properties })}
          saveFirst={save}
        />
      )}

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
