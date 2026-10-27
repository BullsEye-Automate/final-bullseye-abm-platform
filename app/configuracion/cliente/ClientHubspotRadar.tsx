"use client";

import { useEffect, useState } from "react";
import { IconAlertTriangle, IconCheck, IconLoader2, IconPlugConnected, IconX } from "@tabler/icons-react";

// Radar ABM leído del HubSpot propio del cliente: prueba de permisos,
// tamaño del universo y mapeo de propiedades propio de esa cuenta (los
// nombres internos pueden ser distintos a los del HubSpot de BullsEye).

type CheckItem = { key: string; label: string; ok: boolean; required: boolean; detail?: string; scopes?: string[] };
type Detected = { key: string; label: string; object: string; required: boolean; property: string | null; found: boolean; manual: boolean; propLabel: string | null; options: { label: string; value: string }[] };
type CheckResult = { items: CheckItem[]; universe: number | null; contacts: number | null; properties: Detected[]; ready: boolean };

const OBJ_LABEL: Record<string, string> = { companies: "Empresa", contacts: "Contacto", meetings: "Reunión" };

export default function ClientHubspotRadar({
  clientId,
  properties,
  onPropertiesChange,
  saveFirst,
}: {
  clientId: string;
  properties: Record<string, string>;
  onPropertiesChange: (p: Record<string, string>) => void;
  saveFirst: () => Promise<boolean>;
}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConnected(null);
    setResult(null);
    fetch(`/api/clients/${clientId}/hubspot`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setConnected(!!d.connected))
      .catch(() => setConnected(false));
  }, [clientId]);

  async function check() {
    setChecking(true);
    setError(null);
    try {
      // La prueba lee la configuración guardada (origen y mapeo)
      if (!(await saveFirst())) return;
      const r = await fetch(`/api/clients/${clientId}/radar/check`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `Error ${r.status}`);
      setResult(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  if (connected === false) {
    return (
      <div className="rounded-lg px-3 py-2 text-sm bg-warning-bg text-warning-fg flex items-start gap-2">
        <IconAlertTriangle size={16} className="shrink-0 mt-0.5" />
        <span>Este cliente no tiene su HubSpot conectado. Conéctalo arriba en “HubSpot del cliente” (token de app privada de solo lectura) y vuelve a esta sección.</span>
      </div>
    );
  }

  const missing = Array.from(new Set((result?.items ?? []).flatMap((i) => i.scopes ?? [])));
  const setProp = (key: string, value: string) => {
    const next = { ...properties };
    if (value.trim()) next[key] = value.trim();
    else delete next[key];
    onPropertiesChange(next);
  };

  return (
    <div className="space-y-4 rounded-xl border border-[#E5E2F0] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <div className="font-medium flex items-center gap-2"><IconPlugConnected size={16} className="text-brand" /> HubSpot del cliente</div>
          <div className="text-xs text-ink-muted mt-0.5">Prueba los permisos del token, cuenta el universo y detecta las propiedades en su cuenta. No sincroniza nada.</div>
        </div>
        <button onClick={check} disabled={checking || connected === null} className="btn-secondary text-sm">
          {checking ? <IconLoader2 size={15} className="animate-spin" /> : <IconCheck size={15} />} Probar HubSpot del cliente
        </button>
      </div>

      {error && <div className="text-sm text-danger-fg">{error}</div>}

      {result && (
        <>
          <div className={`text-sm rounded-lg px-3 py-2 ${result.ready ? "bg-success-bg text-success-fg" : "bg-warning-bg text-warning-fg"}`}>
            {result.ready
              ? `Listo para sincronizar: ${result.universe ?? 0} empresas y ${result.contacts ?? 0} contactos con status.`
              : "Falta algo obligatorio (permisos o propiedades). Revisa lo marcado en rojo."}
          </div>

          <ul className="text-sm space-y-1.5">
            {result.items.map((i) => (
              <li key={i.key} className="flex items-start gap-2">
                {i.ok ? <IconCheck size={15} className="text-success-fg shrink-0 mt-0.5" /> : <IconX size={15} className={`${i.required ? "text-danger-fg" : "text-warning-fg"} shrink-0 mt-0.5`} />}
                <span>
                  <b className="font-medium">{i.label}</b>
                  {!i.required && !i.ok && <span className="text-ink-muted"> (opcional: sin esto se muestra “Sin información disponible”)</span>}
                  {i.detail && <span className="text-ink-muted"> · {i.detail}</span>}
                </span>
              </li>
            ))}
          </ul>

          {missing.length > 0 && (
            <div className="text-xs text-ink-muted">
              Agrega estos permisos a la app privada del cliente (HubSpot → Configuración → Integraciones → Apps privadas → la app → Permisos) y vuelve a probar:{" "}
              {missing.map((s, i) => <span key={s}><code>{s}</code>{i < missing.length - 1 ? ", " : ""}</span>)}.
            </div>
          )}
        </>
      )}

      <div>
        <div className="text-sm font-medium mb-1">Propiedades en el HubSpot del cliente</div>
        <p className="text-xs text-ink-muted mb-2">
          Se buscan por su etiqueta. Si en su cuenta se llaman distinto, escribe el nombre interno (HubSpot → Configuración → Propiedades → la propiedad → “Nombre interno”). Se guarda solo para este cliente.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-muted border-b border-[#ECEAF4]">
              <tr><th className="py-2 pr-3">Objeto</th><th className="py-2 pr-3">Etiqueta</th><th className="py-2 pr-3">Nombre interno (manual)</th><th className="py-2">Detectado</th></tr>
            </thead>
            <tbody>
              {(result?.properties ?? []).map((d) => (
                <tr key={d.key} className="border-b border-[#ECEAF4] last:border-0 align-top">
                  <td className="py-2 pr-3 text-xs text-ink-muted">{OBJ_LABEL[d.object] ?? d.object}</td>
                  <td className="py-2 pr-3">{d.label}{d.required && <span className="text-danger-fg"> *</span>}</td>
                  <td className="py-2 pr-3">
                    <input className="input w-52 font-mono text-xs" placeholder="automático" value={properties[d.key] ?? ""} onChange={(e) => setProp(d.key, e.target.value)} />
                  </td>
                  <td className="py-2 text-xs">
                    {d.found ? (
                      <span className="text-success-fg"><code>{d.property}</code> · {d.propLabel}{d.options.length ? ` · ${d.options.length} valores` : ""}</span>
                    ) : (
                      <span className={d.required ? "text-danger-fg" : "text-ink-subtle"}>{d.manual ? "ese nombre interno no existe" : "no encontrada"}</span>
                    )}
                  </td>
                </tr>
              ))}
              {!result && (
                <tr><td colSpan={4} className="py-3 text-xs text-ink-subtle">Pulsa “Probar HubSpot del cliente” para ver qué propiedades se detectan.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
