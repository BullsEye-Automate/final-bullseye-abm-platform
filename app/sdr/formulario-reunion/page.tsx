"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconAlertTriangle, IconCalendarPlus, IconExternalLink, IconLoader2, IconRefresh } from "@tabler/icons-react";

// Formulario de reuniones: el mismo formulario que los SDR usaban en GitHub
// Pages (registrar una reunión nueva o actualizar una pendiente), dentro del
// portal. El HTML corre en un iframe aislado (sin allow-same-origin: no ve la
// sesión ni las APIs de la plataforma) y sigue escribiendo en la planilla por
// el Apps Script de siempre. Ver CLAUDE.md → "Formulario de reuniones".

const PUBLIC_URL = "https://bullseye-automate.github.io/Hubspot-y-SDR-Dashboard/";

type Payload = { html: string; source: "live" | "local"; sdrName: string | null };

// Deja elegido al SDR de la sesión en "Responsable" y en "Actualizar reunión"
// cuando el formulario termina de cargar las opciones desde el Apps Script.
function injectSdr(html: string, sdrName: string | null): string {
  if (!sdrName) return html;
  const name = JSON.stringify(sdrName).replace(/</g, "\\u003c");
  const script = `<script>(function(){
  var want=${name};
  function norm(s){return String(s||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/\\s+/g," ").trim();}
  function pick(ts){
    if(!ts||!ts.options)return false;
    var keys=Object.keys(ts.options); if(!keys.length)return false;
    var w=norm(want), wt=w.split(" "), hit=null;
    keys.forEach(function(k){ if(!hit&&norm(k)===w) hit=k; });
    if(!hit){ var c=keys.filter(function(k){var t=norm(k).split(" ");return t[0]===wt[0]&&wt.slice(1).some(function(x){return t.indexOf(x)>0;});}); if(c.length===1) hit=c[0]; }
    if(!hit){ var f=keys.filter(function(k){return norm(k).split(" ")[0]===wt[0];}); if(f.length===1) hit=f[0]; }
    if(hit&&!ts.getValue()) ts.setValue(hit);
    return true;
  }
  var tries=0, iv=setInterval(function(){
    tries++;
    try{
      var ti=(typeof tomInstances!=="undefined")?tomInstances:null;
      if(ti&&ti["s-sdr"]&&Object.keys(ti["s-sdr"].options).length){
        pick(ti["s-sdr"]); pick(ti["edit-sdr-select"]); clearInterval(iv);
      }
    }catch(e){ clearInterval(iv); }
    if(tries>120) clearInterval(iv);
  },250);
})();</script>`;
  return html.includes("</body>") ? html.replace("</body>", script + "</body>") : html + script;
}

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

  const srcDoc = useMemo(() => (data ? injectSdr(data.html, data.sdrName) : ""), [data]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconCalendarPlus size={26} className="text-[#251762]" />
          <div>
            <h1 className="text-xl font-semibold text-[#251762]">Formulario de reuniones</h1>
            <p className="text-sm text-gray-500">
              Registra una reunión agendada o actualiza el estado de una pendiente. Se guarda en la planilla de reuniones.
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
            title="Formulario de reuniones"
            srcDoc={srcDoc}
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
