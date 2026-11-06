"use client";

import dynamic from "next/dynamic";
import { IconLoader2 } from "@tabler/icons-react";

// Fusión del Centro de prospección con el motor de prospección (nov-2026):
// las pantallas de Dashboard, Empresas, Contactos y Búsqueda manual se
// muestran como pestañas dentro del Centro, reutilizando sus componentes tal
// cual (mismas APIs, mismo selector de cliente del menú lateral). Sus rutas
// propias (/dashboard, /empresas, /contactos, /busqueda-manual) siguen vivas.

export type CentroTab = "centro" | "empresas" | "contactos" | "busqueda" | "dashboard";

export const CENTRO_TABS: { key: CentroTab; label: string; hint: string }[] = [
  { key: "centro", label: "Centro", hint: "Equipo, clientes, plan semanal y solicitudes" },
  { key: "empresas", label: "Empresas", hint: "Recomendadas por IA, propuestas y aprobadas por el cliente" },
  { key: "contactos", label: "Contactos", hint: "Contactos sugeridos por la IA para revisar" },
  { key: "busqueda", label: "Búsqueda manual", hint: "Empresas con pocos contactos automáticos" },
  { key: "dashboard", label: "Dashboard", hint: "Prospección automática por cliente y evolución" },
];

export const isCentroTab = (v: string | null): v is CentroTab => !!v && CENTRO_TABS.some((t) => t.key === v);

const loading = () => (
  <div className="card flex items-center gap-2 text-sm text-ink-muted">
    <IconLoader2 size={16} className="animate-spin" /> Cargando…
  </div>
);

const EmpresasPage = dynamic(() => import("@/app/empresas/page"), { ssr: false, loading });
const ContactosPage = dynamic(() => import("@/app/contactos/page"), { ssr: false, loading });
const BusquedaManualPage = dynamic(() => import("@/app/busqueda-manual/page"), { ssr: false, loading });
const DashboardPage = dynamic(() => import("@/app/dashboard/page"), { ssr: false, loading });

export function CentroTabBar({ tab, onChange }: { tab: CentroTab; onChange: (t: CentroTab) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Centro de prospección"
      style={{
        display: "flex", gap: 4, flexWrap: "wrap", background: "#fff", borderRadius: 12, padding: 6,
        boxShadow: "0 1px 0 rgba(38,33,92,.04)", marginBottom: 16, maxWidth: 1640,
      }}
    >
      {CENTRO_TABS.map((t) => {
        const on = t.key === tab;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            title={t.hint}
            onClick={() => onChange(t.key)}
            style={{
              border: 0, cursor: "pointer", borderRadius: 8, padding: "8px 14px", fontSize: 13.5,
              fontFamily: "inherit", fontWeight: on ? 600 : 500,
              background: on ? "rgba(61,40,120,.08)" : "transparent", color: on ? "#3D2878" : "#6B6884",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function CentroTabPanel({ tab }: { tab: CentroTab }) {
  if (tab === "empresas") return <EmpresasPage />;
  if (tab === "contactos") return <ContactosPage />;
  if (tab === "busqueda") return <BusquedaManualPage />;
  if (tab === "dashboard") return <DashboardPage />;
  return null;
}
