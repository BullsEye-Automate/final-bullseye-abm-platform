"use client";

import { useEffect, useState } from "react";
import { IconAlertCircle, IconCloudDataConnection, IconCheck, IconLoader2, IconPlugConnected, IconTrash } from "@tabler/icons-react";

// HubSpot propio del cliente: token de una app privada de solo lectura. Las
// actividades (correo / WhatsApp / LinkedIn) que los SDR registran ahí se
// suman al módulo Células SDR con el cliente identificado. El token se envía
// una vez al servidor y nunca vuelve al navegador (solo los últimos 4).

type Status = { connected: boolean; last4: string | null; users?: number };

// Células SDR usa owners, contactos, empresas y correos; el Pulso ABM además
// lee negocios y la definición de las propiedades. Si a HubSpot le falta
// algún permiso para llamadas, reuniones o comunicaciones, "Probar HubSpot
// del cliente" (Pulso ABM) muestra el nombre exacto que pide.
const SCOPES = [
  "crm.objects.owners.read",
  "crm.objects.contacts.read",
  "crm.objects.companies.read",
  "crm.objects.deals.read",
  "crm.schemas.companies.read",
  "crm.schemas.contacts.read",
  "sales-email-read",
];

export default function HubspotConnection({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    setStatus(null);
    setToken("");
    setError(null);
    setOkMsg(null);
    fetch(`/api/clients/${clientId}/hubspot`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setStatus(d)))
      .catch((e) => setError(e.message));
  }, [clientId]);

  async function connect() {
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    setOkMsg(null);
    const r = await fetch(`/api/clients/${clientId}/hubspot`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.trim() }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(d.error ?? "No se pudo conectar");
    setStatus(d);
    setToken("");
    setOkMsg(`Conectado. ${d.users ?? 0} usuarios en la cuenta de HubSpot.`);
  }

  async function disconnect() {
    if (!confirm("¿Desconectar el HubSpot de este cliente? Sus actividades dejarán de sumarse en Células SDR.")) return;
    setBusy(true);
    setError(null);
    setOkMsg(null);
    const r = await fetch(`/api/clients/${clientId}/hubspot`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(d.error ?? "No se pudo desconectar");
    setStatus(d);
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-semibold flex items-center gap-2">
          <IconCloudDataConnection size={18} className="text-brand" /> HubSpot del cliente
        </h2>
        <p className="text-sm text-ink-muted mt-1">
          Solo si el cliente se trabaja en su propio HubSpot. Los correos, WhatsApp y LinkedIn que los SDR
          registran ahí se suman a Células SDR con el cliente identificado, y el Pulso ABM puede leer su universo desde aquí. Si se trabaja en el HubSpot de
          BullsEye, déjalo sin conectar.
        </p>
      </div>

      {!status && !error ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <IconLoader2 size={14} className="animate-spin" /> Cargando…
        </div>
      ) : status?.connected ? (
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-[#E5E2F0] bg-white text-sm">
          <span className="flex items-center gap-2">
            <IconPlugConnected size={16} className="text-green-600" />
            Conectado <span className="text-ink-muted font-mono">••••{status.last4}</span>
          </span>
          <button onClick={disconnect} disabled={busy} className="text-ink-muted hover:text-red-500 transition flex items-center gap-1 text-xs">
            <IconTrash size={14} /> Desconectar
          </button>
        </div>
      ) : null}

      <div>
        <label className="label block mb-1">{status?.connected ? "Reemplazar token" : "Token de la app privada"}</label>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="pat-na1-…"
          />
          <button onClick={connect} disabled={busy || !token.trim()} className="btn-primary">
            {busy ? <IconLoader2 size={16} className="animate-spin" /> : <IconCheck size={16} />}
            Probar y conectar
          </button>
        </div>
        <p className="text-xs text-ink-subtle mt-1">
          En el HubSpot del cliente: Configuración → Integraciones → Apps privadas → Crear app privada, con
          permisos de solo lectura: {SCOPES.map((s, i) => <span key={s}><code>{s}</code>{i < SCOPES.length - 1 ? ", " : ""}</span>)}.
          Copia el token de acceso y pégalo aquí. Se guarda solo en el servidor.
        </p>
      </div>

      {okMsg && <div className="text-sm text-green-700 flex items-center gap-2"><IconCheck size={14} /> {okMsg}</div>}
      {error && <div className="text-sm text-danger-fg flex items-center gap-2"><IconAlertCircle size={14} /> {error}</div>}
    </section>
  );
}
