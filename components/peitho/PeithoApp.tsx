"use client";

import PeithoWorkspace from "./app/PeithoWorkspace";

// Vista de Peitho para un cliente que lo tiene contratado: Panel de control,
// Reuniones futuras (research) y pasadas (análisis) con los datos reales del
// backend de Peitho (ver lib/peithoIntegration.ts). En la app interna suma la
// gestión de usuarios de Peitho del cliente.
export default function PeithoApp({ audience, clientId }: { audience: "internal" | "portal"; clientId?: string | null }) {
  if (audience === "internal" && !clientId) return null;
  const base = audience === "portal" ? "/api/portal/peitho/proxy" : `/api/clients/${clientId}/peitho/proxy`;
  return <PeithoWorkspace key={base} base={base} internal={audience === "internal"} />;
}
