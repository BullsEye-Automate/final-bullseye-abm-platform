"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconAlertTriangle, IconCalendarPlus, IconExternalLink, IconLoader2, IconRefresh } from "@tabler/icons-react";

// Formulario de reuniones: el mismo formulario que los SDR usaban en GitHub
// Pages (registrar una reunión nueva o actualizar una pendiente), dentro del
// portal. El HTML corre en un iframe aislado (sin allow-same-origin: no ve la
// sesión ni las APIs de la plataforma) y sigue escribiendo en la planilla por
// el Apps Script de siempre. Ver CLAUDE.md → "Formulario de reuniones".

const PUBLIC_URL = "https://bullseye-automate.github.io/Hubspot-y-SDR-Dashboard/";

type Payload = { html: string; source: "live" | "local"; sdrName: string | null };

export default function FormularioReunionPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      const res = await fetch("/api/sdr/formulario-reunion", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo cargar el formulario");
      setData(json);
      setNonce((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // El formulario pide el resumen con IA por postMessage (content/formulario-
  // reunion/bridge.js): la página llama a la API con la sesión y le devuelve
  // el resultado. Solo se atienden mensajes del iframe del formulario.
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const frame = iframeRef.current?.contentWindow;
      if (!frame || e.source !== frame) return;
      const m = e.data || {};
      if (m.type !== "be-form:summary") return;
      let reply: Record<string, unknown>;
      try {
        const res = await fetch("/api/sdr/formulario-reunion/resumen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(m.data || {}),
        });
        const json = await res.json().catch(() => ({}));
        reply = res.ok && json.ai ? { ai: json.ai } : { error: json.error || `error ${res.status}` };
      } catch (err) {
        reply = { error: (err as Error).message || "sin conexión" };
      }
      frame.postMessage({ type: "be-form:summary-result", id: m.id, ...reply }, "*");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconCalendarPlus size={26} className="text-[#251762]" />
          <div>
            <h1 className="text-xl font-semibold text-[#251762]">Formulario de reuniones</h1>
            <p className="text-sm text-gray-500">
              Registra una reunión agendada o actualiza el estado de una pendiente. Se guarda en la planilla de reuniones. No se
              permiten reuniones en feriados del país del prospecto.
              {data?.sdrName ? ` Responsable sugerido: ${data.sdrName}.` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-secondary flex items-center gap-1 text-sm" title="Volver a cargar el formulario">
            <IconRefresh size={16} /> Recargar
          </button>
          <a href={PUBLIC_URL} target="_blank" rel="noreferrer" className="btn-secondary flex items-center gap-1 text-sm">
            <IconExternalLink size={16} /> Abrir en otra pestaña
          </a>
        </div>
      </div>

      {data?.source === "local" && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <IconAlertTriangle size={18} className="mt-0.5 shrink-0" />
          GitHub Pages no respondió: se muestra la copia guardada en la plataforma. Funciona igual, pero podría no tener el último cambio del formulario.
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <IconAlertTriangle size={18} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {!data && !error && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <IconLoader2 size={18} className="animate-spin" /> Cargando formulario…
        </div>
      )}

      {data && (
        <div className="card p-0 overflow-hidden">
          <iframe
            key={nonce}
            ref={iframeRef}
            title="Formulario de reuniones"
            srcDoc={data.html}
            className="w-full block"
            style={{ height: "88vh", border: 0 }}
            // allow-forms: el envío pasa por el evento submit del formulario.
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
            // Botón "Copiar para WhatsApp" del resumen.
            allow="clipboard-write"
          />
        </div>
      )}
    </div>
  );
}
