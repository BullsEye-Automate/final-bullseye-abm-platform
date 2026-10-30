"use client";

import { useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import PeithoApp from "./PeithoApp";
import PeithoLanding from "./PeithoLanding";

// Peitho según "Incluir Peitho" del cliente (Config. cliente):
// Sí → la app Peitho; No o sin configurar → landing comercial.
// En el portal el cliente sale de la sesión (/api/portal/peitho); en la app
// interna, del cliente elegido (/api/clients/[id]/peitho).
export default function PeithoPanel({
  audience,
  clientId,
  clientName,
}: {
  audience: "internal" | "portal";
  clientId?: string | null;
  clientName?: string | null;
}) {
  const [state, setState] = useState<{ enabled: boolean; name: string | null } | null>(null);

  useEffect(() => {
    if (audience === "internal" && !clientId) { setState({ enabled: false, name: null }); return; }
    setState(null);
    fetch(audience === "portal" ? "/api/portal/peitho" : `/api/clients/${clientId}/peitho`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setState({ enabled: !!j.enabled, name: j.client_name ?? clientName ?? null }))
      .catch(() => setState({ enabled: false, name: clientName ?? null }));
  }, [audience, clientId, clientName]);

  if (!state) return <div className="text-sm text-gray-500 flex items-center gap-2"><IconLoader2 size={15} className="animate-spin" /> Cargando…</div>;
  return <div className="ra-plain">{state.enabled ? <PeithoApp clientName={state.name} /> : <PeithoLanding clientName={state.name} />}</div>;
}
