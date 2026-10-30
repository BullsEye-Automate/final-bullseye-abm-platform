"use client";

import { useEffect, useState } from "react";
import { IconCopy, IconExternalLink, IconLoader2 } from "@tabler/icons-react";
import ClientFeedbackBoard from "@/components/feedback/ClientFeedbackBoard";
import type { RadarAudience } from "./RadarReport";

// Pulso ABM → Feedback manual → Completar feedback. En el portal el
// cliente evalúa sus reuniones realizadas ahí mismo (mismo formulario y
// tabla que el link /feedback-cliente/<token>). En la vista interna se
// muestra el link para compartirlo; el equipo no completa el feedback.

export default function FeedbackPanel({ audience, clientId }: { audience: RadarAudience; clientId?: string | null }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

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

  if (audience === "portal") {
    return <div className="ra-plain-card"><ClientFeedbackBoard token={token} embedded /></div>;
  }
  const url = `${typeof window !== "undefined" ? window.location.origin : ""}/feedback-cliente/${token}`;
  return (
    <div className="ra-plain-card text-sm text-gray-700">
      <p className="mb-3">El cliente completa el feedback de cada reunión realizada en su portal (Pulso ABM → Feedback manual) o con este link:</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-xs break-all">{url}</code>
        <button className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs" onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          <IconCopy size={13} /> {copied ? "Copiado" : "Copiar"}
        </button>
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs"><IconExternalLink size={13} /> Abrir</a>
      </div>
    </div>
  );
}
