"use client";

import { useCallback, useEffect, useState } from "react";
import { IconLoader2, IconRefresh } from "@tabler/icons-react";

// Base de empresas HubSpot que usa la wishlist (sync por tramos) + diagnóstico
// de la base Lemlist del cliente. Se muestra en Config. cliente.

const fmt = (iso: string) => new Date(iso).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" });

type PoolState = {
  status: "idle" | "running" | "done" | "error";
  synced_count: number;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  total_in_pool: number;
};

export default function HubspotPoolPanel({ clientId, clientName }: { clientId: string | null; clientName: string | null }) {
  const [state, setState] = useState<PoolState | null>(null);
  const [props, setProps] = useState<{ name: string; label: string; filled_count: number }[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/portal-admin/hubspot-pool", { cache: "no-store" });
    const j = await r.json();
    if (r.ok) {
      setState(j.state);
      setProps(j.properties);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sincroniza por tramos hasta terminar (cada llamada ~2.000 empresas)
  async function sync() {
    setSyncing(true);
    setError(null);
    let restart = true;
    for (let i = 0; i < 40; i++) {
      const r = await fetch("/api/portal-admin/hubspot-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restart }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ?? "Error sincronizando");
        break;
      }
      restart = false;
      setProgress(j.synced_count);
      if (j.done) break;
    }
    setSyncing(false);
    setProgress(null);
    load();
  }

  async function runCheck() {
    if (!clientId) return;
    setChecking(true);
    const r = await fetch(`/api/portal-admin/lemlist-check?client_id=${clientId}`, { cache: "no-store" });
    setCheck(await r.json().catch(() => ({ error: "Respuesta inválida" })));
    setChecking(false);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium" style={{ color: "#251762" }}>Base de empresas HubSpot</div>
            <div className="text-sm text-gray-500">
              {state ? `${state.total_in_pool.toLocaleString("es-CL")} empresas disponibles para la wishlist` : "Cargando…"}
              {state?.finished_at ? ` · última sincronización ${fmt(state.finished_at)}` : ""}
            </div>
          </div>
          <button
            onClick={sync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-white disabled:opacity-60"
            style={{ background: "#251762" }}
          >
            {syncing ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />}
            {syncing ? `Sincronizando… ${progress != null ? progress.toLocaleString("es-CL") : ""}` : "Sincronizar ahora"}
          </button>
        </div>
        {(error || state?.last_error) && (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mt-4">{error ?? state?.last_error}</div>
        )}
        <p className="text-xs text-gray-400 mt-3">
          Solo se copian datos de la empresa (grupo &quot;Información de la empresa&quot; + Tecnologías). Nunca owner, etapa, negocios, notas ni propiedades bullseye_*.
        </p>
        {props.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-gray-600">Propiedades filtrables ({props.length})</summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {props.map((p) => (
                <span key={p.name} className="text-xs bg-gray-100 rounded-full px-2.5 py-1 text-gray-600">
                  {p.label} · {p.filled_count.toLocaleString("es-CL")}
                </span>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium" style={{ color: "#251762" }}>Base de Lemlist del cliente</div>
            <div className="text-sm text-gray-500">
              Usa la API key de Lemlist del cliente (Config. cliente). Prueba los filtros y la búsqueda de empresas.
            </div>
          </div>
          <button
            onClick={runCheck}
            disabled={!clientId || checking}
            className="px-4 py-2 rounded-xl text-sm border border-gray-200 disabled:opacity-50"
          >
            {checking ? "Probando…" : clientId ? `Probar con ${clientName}` : "Selecciona un cliente"}
          </button>
        </div>
        {check !== null && (
          <pre className="mt-4 bg-gray-50 rounded-xl p-3 text-xs overflow-x-auto max-h-80">{JSON.stringify(check, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
