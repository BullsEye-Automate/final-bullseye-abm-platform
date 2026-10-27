"use client";

import "@/components/radar/radar.css";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { IconAlertCircle, IconLoader2, IconRefresh, IconSettings } from "@tabler/icons-react";
import { useClient, ALL_CLIENTS } from "@/lib/clientContext";
import { PARTS } from "@/lib/radarAbm/render";
import { DEFAULT_CONFIG } from "@/lib/radarAbm/dictionaries";
import type { RadarConfig, RadarDataset } from "@/lib/radarAbm/types";
import RadarReport, { visibleParts } from "@/components/radar/RadarReport";
import { PART_ICONS } from "@/components/radar/partIcons";

// Análisis → Radar ABM: informe ABM integral por cliente (cuenta → contactos
// → actividad → conversación → interés → reunión → seguimiento →
// oportunidad). Mide cuentas, profundidad e inteligencia de mercado; no
// reemplaza el reporte de productividad SDR (Células SDR). Un cliente a la
// vez: los clientes no se comparan entre sí. Es la misma vista que el
// cliente ve en su portal (/portal/radar), más el anexo de validación.

type ApiResponse = {
  dataset: RadarDataset | null;
  syncedAt?: string | null;
  warnings?: string[];
  stats?: Record<string, number> | null;
  settings?: { portal_enabled: boolean };
  master?: { active: boolean; text: string };
  config: RadarConfig;
  error?: string;
};

export default function RadarAbmPage() {
  const { currentClient } = useClient();
  const clientId = currentClient && currentClient.id !== ALL_CLIENTS.id ? currentClient.id : null;
  const [view, setView] = useState(0);
  const [demo, setDemo] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Última vista vista (preferencia local)
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem("radar-view"));
      if (Number.isInteger(v) && v >= 0 && v < PARTS.length) setView(v);
    } catch { /* sin almacenamiento */ }
  }, []);
  const changeView = (v: number) => {
    setView(v);
    try { localStorage.setItem("radar-view", String(v)); } catch { /* sin almacenamiento */ }
  };

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/radar-abm?client_id=${clientId}${demo ? "&demo=1" : ""}`, { cache: "no-store" });
      const j = (await r.json()) as ApiResponse;
      if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
      setData(j);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clientId, demo]);

  useEffect(() => { setSyncMsg(null); load(); }, [load]);

  async function sync() {
    if (!clientId) return;
    setSyncing(true);
    setError(null);
    setSyncMsg(null);
    try {
      const r = await fetch(`/api/radar-abm?client_id=${clientId}`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
      const s = j.stats ?? {};
      setSyncMsg(`Sincronizado: ${s.companies ?? 0} empresas, ${s.contacts ?? 0} contactos, ${s.meetings ?? 0} reuniones, ${s.deals ?? 0} negocios.`);
      setDemo(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  if (!clientId) {
    return (
      <div className="ra-root">
        <h1 className="text-2xl font-semibold" style={{ color: "#251762" }}>Radar ABM</h1>
        <div className="ra-empty" style={{ marginTop: 16 }}>
          Elige un cliente en el menú lateral: el Radar ABM se lee un cliente a la vez (los universos e ICP de cada cliente no son comparables).
        </div>
      </div>
    );
  }

  const parts = visibleParts("internal");
  const actions = (
    <>
      <button className="ra-btn" onClick={() => setDemo((d) => !d)} title="Alterna entre los datos sincronizados y los datos demo del prototipo">
        {demo ? "Ver datos reales" : "Ver datos demo"}
      </button>
      <button className="ra-btn pri" onClick={sync} disabled={syncing} title="Sincroniza este cliente desde HubSpot">
        {syncing ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />} {syncing ? "Actualizando…" : "Actualizar"}
      </button>
      <Link href="/analisis/radar-abm/configuracion" className="ra-btn" title="Metas, pesos, tramos, cargos y propiedades de HubSpot">
        <IconSettings size={15} />
      </Link>
    </>
  );

  return (
    <div className="ra-root">
      <div className="ra-layout">
        <nav className="ra-nav" aria-label="Partes del informe">
          <div className="ra-grp">Informe</div>
          {parts.map((i) => {
            const Icon = PART_ICONS[i];
            return (
              <div key={i} style={{ display: "contents" }}>
                {PARTS[i][0] === "XII" && <div className="ra-grp">Datos</div>}
                <button className={i === view ? "on" : ""} onClick={() => changeView(i)}>
                  <Icon size={16} stroke={1.6} /> <span>{PARTS[i][1]}</span>
                </button>
              </div>
            );
          })}
        </nav>
        <div style={{ minWidth: 0 }}>
          {error && <div className="ra-banner err"><IconAlertCircle size={16} /> {error}</div>}
          {syncMsg && <div className="ra-banner info">{syncMsg}</div>}
          {!demo && data?.warnings && data.warnings.length > 0 && (
            <details className="ra-banner warn" style={{ display: "block" }}>
              <summary style={{ cursor: "pointer" }}>Avisos de la última sincronización ({data.warnings.length})</summary>
              <ul className="clean" style={{ marginTop: 6 }}>{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}
          {!demo && data?.master && !data.master.active && (
            <div className="ra-banner warn">{data.master.text} No se sincroniza ni se muestra en el portal mientras no esté activo.</div>
          )}
          {!demo && data?.settings && !data.settings.portal_enabled && (
            <div className="ra-banner info">Este informe está oculto en el portal del cliente (Configuración → Cliente → Radar ABM).</div>
          )}
          <div style={{ height: 10 }} />
          {loading && !data ? (
            <div className="ra-empty"><IconLoader2 size={18} className="animate-spin" /> Cargando…</div>
          ) : data?.dataset ? (
            <RadarReport dataset={data.dataset} config={data.config ?? DEFAULT_CONFIG} view={view} onView={changeView} audience="internal" actions={actions} />
          ) : data ? (
            <div className="ra-empty">
              <b style={{ color: "var(--ink)" }}>{currentClient?.name} todavía no tiene datos sincronizados.</b>
              <span>Pulsa “Actualizar” para leer su universo desde HubSpot, o revisa el formato con los datos demo.</span>
              <div className="ra-actions" style={{ marginTop: 6 }}>{actions}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
