"use client";

import "@/components/centroProspeccion/legacy/base.css";
import "@/components/centroProspeccion/legacy/theme.css";
import { useEffect, useRef, useState } from "react";
import { IconAlertCircle, IconLoader2 } from "@tabler/icons-react";
import { CENTRO_MARKUP } from "@/components/centroProspeccion/legacy/markup";
import { createPortalClaude } from "@/components/centroProspeccion/portalClaude";
import { loadCentroLibs } from "@/components/centroProspeccion/loadLibs";
import { startPortalEnhancer } from "@/components/centroProspeccion/portalEnhancer";
import { CentroTabBar, CentroTabPanel, isCentroTab, type CentroTab } from "@/components/centroProspeccion/CentroTabs";
import { useClient } from "@/lib/clientContext";

// Centro de prospección (Prospección → Centro de prospección): el antiguo
// artifact "Centro de prospección BullsEye" de claude.ai dentro del portal.
// Vistas: Resumen del equipo, Solicitudes, Registro de avance, Comparativo,
// Plan semanal (Mi semana), Cuentas, Clientes, Efectividad, Mantenimiento y
// Cruce de contactos. La lógica es la del artifact sin cambios
// (components/centroProspeccion/legacy/app.js); los datos vienen de
// /api/centro/* a través de portalClaude.ts.
//
// Fusión (nov-2026): arriba, pestañas Centro · Empresas · Contactos ·
// Búsqueda manual · Dashboard. Las cuatro últimas son las pantallas del motor
// de prospección, reutilizadas tal cual (CentroTabs.tsx). El Centro queda
// montado mientras se usa otra pestaña. ?tab=<clave> abre una pestaña y los
// botones del Centro (portalSections.ts) cambian de pestaña con el cliente
// ya elegido (evento "cp:go").

const PATH_TAB: Record<string, CentroTab> = {
  "/empresas": "empresas", "/contactos": "contactos", "/busqueda-manual": "busqueda", "/dashboard": "dashboard",
};

export default function CentroProspeccionPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<CentroTab>("centro");
  const { clients, setCurrentClient } = useClient();

  // Pestaña inicial desde ?tab= y la URL al día al cambiar (se conserva el #vista del Centro)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (isCentroTab(t)) setTab(t);
  }, []);
  const changeTab = (t: CentroTab) => {
    setTab(t);
    try {
      const u = new URL(window.location.href);
      if (t === "centro") u.searchParams.delete("tab"); else u.searchParams.set("tab", t);
      window.history.replaceState(window.history.state, "", u.toString());
    } catch { /* nada */ }
    window.scrollTo({ top: 0 });
  };

  // Botones del Centro que llevan a Empresas / Contactos / Búsqueda manual / Dashboard
  useEffect(() => {
    const onGo = (e: Event) => {
      const d = (e as CustomEvent<{ path: string; clientId?: string; handled?: boolean }>).detail;
      const t = PATH_TAB[d?.path ?? ""];
      if (!t) return;
      d.handled = true;
      const c = d.clientId ? clients.find((x) => x.id === d.clientId) : null;
      if (c) setCurrentClient(c);
      changeTab(t);
    };
    window.addEventListener("cp:go", onGo);
    return () => window.removeEventListener("cp:go", onGo);
  }, [clients, setCurrentClient]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let unmount: (() => void) | null = null;
    let cancelled = false;
    root.innerHTML = CENTRO_MARKUP;

    (async () => {
      try {
        const [{ Chart, ExcelJS, Papa }, appMod] = await Promise.all([
          loadCentroLibs(),
          import("@/components/centroProspeccion/legacy/app.js"),
        ]);
        if (cancelled) return;
        const claude = createPortalClaude((e) => {
          if ((e as { code?: string }).code === "unauthenticated") window.location.href = "/login";
        });
        const stopCentro = appMod.mountCentro(root, { claude, Chart, ExcelJS, Papa });
        // Datos del portal en la ficha (ICP) y en el plan (avance automático)
        const stopEnhancer = startPortalEnhancer(root);
        unmount = () => { stopEnhancer(); stopCentro(); };
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message || "No se pudo cargar el módulo");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      try { unmount?.(); } catch { /* nada */ }
      root.innerHTML = "";
    };
  }, []);

  return (
    <>
      {loading && (
        <div className="card flex items-center gap-2 text-sm text-ink-muted mb-4" style={{ maxWidth: 1640 }}>
          <IconLoader2 size={16} className="animate-spin" /> Cargando el Centro de prospección…
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-danger-bg text-danger-fg text-sm px-4 py-3 mb-4" style={{ maxWidth: 1640 }}>
          <IconAlertCircle size={16} className="mt-0.5" />
          <span>No se pudo cargar el Centro de prospección: {error}</span>
        </div>
      )}
      <CentroTabBar tab={tab} onChange={changeTab} />
      {tab !== "centro" && <CentroTabPanel tab={tab} />}
      <div ref={rootRef} className="cp-root" style={tab === "centro" ? undefined : { display: "none" }} />
    </>
  );
}
