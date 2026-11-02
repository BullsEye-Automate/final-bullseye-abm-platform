"use client";

import { useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import ClientFeedbackBoard from "@/components/feedback/ClientFeedbackBoard";
import type { RadarAudience } from "./RadarReport";

// Pulso ABM → Feedback manual → Completar feedback. El cliente (portal) y el
// equipo (vista interna) ven el mismo tablero del link
// /feedback-cliente/<token>: reuniones pendientes y completadas, y el
// formulario para dejar el feedback ahí mismo.

export default function FeedbackPanel({ audience, clientId }: { audience: RadarAudience; clientId?: string | null }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (audience === "internal" && !clientId) { setToken(null); return; }
    setToken(undefined);
    fetch(audience === "portal" ? "/api/portal/feedback" : `/api/radar-abm/feedback?client_id=${clientId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setToken(j.token ?? null))
      .catch(() => setToken(null));
  }, [audience, clientId]);

  if (token === undefined) return <div className="ra-plain-card text-sm text-gray-500 flex items-center gap-2"><IconLoader2 size={15} className="animate-spin" /> Cargando…</div>;
  if (!token) return <div className="ra-plain-card text-sm text-gray-600">El feedback de reuniones no está habilitado para esta cuenta.</div>;

  return <div className="ra-plain ra-plain-card"><ClientFeedbackBoard key={token} token={token} embedded /></div>;
}
