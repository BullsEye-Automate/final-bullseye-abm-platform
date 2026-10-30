"use client";

import { createContext, useContext } from "react";

// Contexto de la vista de Peitho dentro del portal de BullsEye. Los
// componentes portados de peitho-frontend llamaban a las rutas /api/* propias
// de esa app; acá todo pasa por el proxy del portal (lib/peithoIntegration.ts):
//   - portal del cliente: /api/portal/peitho/proxy/<ruta> (cliente de la sesión)
//   - app interna:        /api/clients/<id>/peitho/proxy/<ruta>
// y la navegación entre reuniones es estado local (no hay rutas propias).
export type PeithoCtx = {
  // path = ruta del backend de Peitho, con su query (ej. "/panel/funnel?from=…")
  api: (path: string, init?: RequestInit) => Promise<Response>;
  openMeeting: (id: string) => void;
  refresh: () => void;
};

export const PeithoContext = createContext<PeithoCtx>({
  api: () => Promise.reject(new Error("Peitho sin configurar")),
  openMeeting: () => {},
  refresh: () => {},
});

export const usePeitho = () => useContext(PeithoContext);

export function peithoApiFor(base: string) {
  return (path: string, init?: RequestInit) => fetch(`${base}${path}`, { cache: "no-store", ...init });
}
