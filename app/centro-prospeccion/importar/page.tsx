"use client";

import { useState } from "react";
import Link from "next/link";
import { IconAlertCircle, IconCheck, IconLoader2, IconUpload } from "@tabler/icons-react";

// Importación del respaldo del artifact "Centro de prospección BullsEye"
// (solo administradores del Centro, ver lib/centroProspeccion/access.ts).
// El respaldo es un JSON con todas las colecciones y los archivos de los
// clientes; se envía en tandas pequeñas para no pasar el límite de Vercel.

type Bundle = {
  formato: string;
  generado?: string;
  colecciones: Record<string, { id: string; data: Record<string, unknown> }[]>;
  archivos?: { id: string; nombre: string; contentType: string; base64: string }[];
};

const MAX_DOCS = 200;
const MAX_BYTES = 3_000_000;

async function post(body: unknown) {
  const res = await fetch("/api/centro/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Error ${res.status}`);
  return j;
}

// URL del conector MCP para las tareas programadas de claude.ai
// (se agrega en claude.ai → Configuración → Conectores → Agregar conector personalizado).
function ConnectorUrl() {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  async function show() {
    setErr(null);
    try {
      const res = await fetch("/api/centro/mcp-url", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `Error ${res.status}`);
      setUrl(j.url);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* sin portapapeles */ }
  }
  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-semibold">Conector para las tareas programadas</h2>
        <p className="text-sm text-ink-muted mt-1">
          Agrégalo en claude.ai → Configuración → Conectores → «Agregar conector personalizado», con el nombre
          «Centro de prospección» y esta URL. La URL incluye una clave privada: no la compartas.
        </p>
      </div>
      {!url ? (
        <button className="btn-secondary w-fit" onClick={show}>Mostrar la URL del conector</button>
      ) : (
        <div className="flex gap-2 items-center">
          <input className="input font-mono text-xs" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn-primary shrink-0" onClick={copy}>{copied ? "Copiada" : "Copiar"}</button>
        </div>
      )}
      {err && <p className="text-sm text-danger-fg">{err}</p>}
    </div>
  );
}

export default function ImportarCentroPage() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = (s: string) => setLog((l) => [...l, s]);

  async function onFile(f: File | undefined) {
    setFileErr(null); setBundle(null); setDone(false); setLog([]); setErr(null);
    if (!f) return;
    try {
      const b = JSON.parse(await f.text()) as Bundle;
      if (b.formato !== "centro-prospeccion-v1" || typeof b.colecciones !== "object") throw new Error("El archivo no es un respaldo del Centro de prospección");
      setBundle(b);
    } catch (e) {
      setFileErr((e as Error).message);
    }
  }

  async function run() {
    if (!bundle) return;
    setRunning(true); setErr(null); setLog([]); setDone(false);
    try {
      const cols = Object.keys(bundle.colecciones);
      if (replace) {
        await post({ action: "reset", collections: cols });
        add(`Colecciones vaciadas: ${cols.join(", ")}`);
      }
      for (const c of cols) {
        const docs: Bundle["colecciones"][string] = bundle.colecciones[c];
        let batch: Bundle["colecciones"][string] = [];
        let bytes = 0;
        let n = 0;
        const flush = async () => {
          if (!batch.length) return;
          const r = await post({ action: "docs", collection: c, docs: batch });
          n += r.written ?? 0;
          batch = []; bytes = 0;
        };
        for (const d of docs) {
          const size = JSON.stringify(d).length;
          if (batch.length >= MAX_DOCS || (bytes + size > MAX_BYTES && batch.length)) await flush();
          batch.push(d); bytes += size;
        }
        await flush();
        add(`${c}: ${n} de ${docs.length} documentos`);
      }
      for (const a of bundle.archivos ?? []) {
        await post({ action: "asset", id: a.id, fileName: a.nombre, contentType: a.contentType, base64: a.base64 });
        add(`Archivo: ${a.nombre}`);
      }
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const total = bundle ? Object.values(bundle.colecciones).reduce((s, x) => s + x.length, 0) : 0;

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <div className="label">Centro de prospección</div>
        <h1 className="text-2xl font-semibold tracking-tight">Importar respaldo del artifact</h1>
        <p className="text-sm text-ink-muted mt-1">
          Carga en el portal los datos exportados del artifact de claude.ai (clientes, solicitudes, registro, plan semanal,
          cuentas, historial, configuración, resultados y archivos). Solo lo puede hacer el administrador del Centro.
        </p>
      </div>

      <div className="card space-y-4">
        <label className="btn-secondary cursor-pointer w-fit">
          <IconUpload size={16} /> Elegir archivo de respaldo (.json)
          <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} disabled={running} />
        </label>
        {fileErr && <p className="text-sm text-danger-fg">{fileErr}</p>}
        {bundle && (
          <div className="text-sm space-y-1">
            <p><b>{total.toLocaleString("es-CL")}</b> documentos en {Object.keys(bundle.colecciones).length} colecciones y {bundle.archivos?.length ?? 0} archivos{bundle.generado ? `, exportado el ${new Date(bundle.generado).toLocaleString("es-CL")}` : ""}.</p>
            <ul className="text-ink-muted">
              {Object.entries(bundle.colecciones).map(([c, d]) => <li key={c}>{c}: {d.length}</li>)}
            </ul>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} disabled={running} className="mt-1" />
          <span>Reemplazar todo: vacía primero las colecciones del respaldo para que el portal quede idéntico al artifact (recomendado en la carga final).</span>
        </label>
        <button className="btn-primary" onClick={run} disabled={!bundle || running}>
          {running ? <IconLoader2 size={16} className="animate-spin" /> : <IconUpload size={16} />} Importar
        </button>
      </div>

      <ConnectorUrl />

      {(log.length > 0 || err || done) && (
        <div className="card text-sm space-y-1">
          {log.map((l, i) => <p key={i} className="text-ink-muted">{l}</p>)}
          {err && <p className="flex items-center gap-2 text-danger-fg"><IconAlertCircle size={16} /> {err}</p>}
          {done && (
            <p className="flex items-center gap-2 text-success-fg font-medium">
              <IconCheck size={16} /> Importación completa. <Link href="/centro-prospeccion" className="underline">Abrir el Centro de prospección</Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
