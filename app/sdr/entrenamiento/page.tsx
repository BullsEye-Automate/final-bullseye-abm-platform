"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertTriangle,
  IconChartBar,
  IconCheck,
  IconDownload,
  IconExternalLink,
  IconLoader2,
  IconSchool,
  IconSettings,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { useClient, ALL_CLIENTS } from "@/lib/clientContext";
import { injectBridge } from "@/lib/academiaSdr/bridge";
import { LAP_COUNT, type ProgressConfig } from "@/lib/academiaSdr/catalog";

// Entrenamiento cliente (antes "Academia SDR"): la academia HTML del
// proyecto de Claude de cada cliente, tal cual se diseñó, con registro de
// ingresos y vueltas por SDR. Ver CLAUDE.md → "Entrenamiento cliente".

type Tab = "capacitacion" | "seguimiento" | "configurar";

type TrainingMeta = {
  title: string;
  origin: "subido" | "proyecto";
  sourceUrl: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  tracking: boolean;
  hasProjectVersion: boolean;
  progress: ProgressConfig | null;
};

type CoverageRow = { id: string; name: string; slug: string; origin: "subido" | "proyecto" | null };

type TrackingRow = {
  email: string;
  sdrName: string | null;
  leaderName: string | null;
  visits: number;
  firstVisit: string | null;
  lastVisit: string | null;
  completed: number[];
  lastCompletedAt: string | null;
  quizScore: number | null;
  quizTotal: number | null;
  quizAttempts: number;
};

const LAPS = Array.from({ length: LAP_COUNT }, (_, i) => i + 1);

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function EntrenamientoClientePage() {
  const { currentClient, clients, setCurrentClient } = useClient();
  const clientId = currentClient && currentClient.id !== ALL_CLIENTS.id ? currentClient.id : null;

  const [tab, setTab] = useState<Tab>("capacitacion");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [training, setTraining] = useState<TrainingMeta | null>(null);
  const [rawHtml, setRawHtml] = useState("");
  // Vueltas ya completadas por el usuario (se cargan una vez por cliente: si
  // cambiaran en cada evento el iframe se recargaría).
  const [seedDone, setSeedDone] = useState<number[]>([]);
  const [tracking, setTracking] = useState<TrackingRow[]>([]);
  const [coverage, setCoverage] = useState<CoverageRow[] | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const visitedFor = useRef<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "seguimiento" || t === "configurar") setTab(t);
  }, []);

  function loadCoverage() {
    fetch("/api/academia-sdr/coverage")
      .then((r) => r.json())
      .then((d) => !d.error && setCoverage(d.clients ?? []))
      .catch(() => {});
  }
  useEffect(loadCoverage, []);

  function loadTracking(id: string, withSeed = false) {
    return fetch(`/api/academia-sdr/progress?client_id=${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) return;
        setTracking(data.tracking ?? []);
        if (withSeed) setSeedDone(data.me ?? []);
      })
      .catch(() => {});
  }

  async function loadClient(id: string) {
    setLoading(true);
    setError(null);
    setTraining(null);
    setRawHtml("");
    setSeedDone([]);
    setTracking([]);
    try {
      const [r] = await Promise.all([fetch(`/api/academia-sdr?client_id=${id}`), loadTracking(id, true)]);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "No se pudo cargar el entrenamiento");
      setTraining(data.training);
      setSourceUrl(data.training?.origin === "subido" ? data.training.sourceUrl ?? "" : "");
      if (data.training) {
        const h = await fetch(`/api/academia-sdr/html?client_id=${id}`);
        if (!h.ok) throw new Error("No se pudo leer el HTML del entrenamiento");
        setRawHtml(await h.text());
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (clientId) void loadClient(clientId);
  }, [clientId]);

  const srcDoc = useMemo(() => (rawHtml && training ? injectBridge(rawHtml, training.progress, seedDone) : ""), [rawHtml, training, seedDone]);

  // Registra un ingreso cada vez que se abre la capacitación de un cliente.
  useEffect(() => {
    if (!clientId || !srcDoc || tab !== "capacitacion" || visitedFor.current === clientId) return;
    visitedFor.current = clientId;
    void fetch("/api/academia-sdr/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, type: "visit" }),
    });
  }, [clientId, srcDoc, tab]);

  // El puente del iframe avisa cuando se completa o desmarca una vuelta o se
  // responde el quiz; el servidor lo guarda y, la primera vez que se completa
  // una vuelta, avisa por correo a la líder del SDR.
  useEffect(() => {
    if (!clientId) return;
    const id = clientId;
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as { source?: string; type?: string; no?: number; score?: number; total?: number };
      if (d?.source !== "academia-sdr" || !["lap_done", "lap_undone", "quiz"].includes(d.type ?? "")) return;
      void fetch("/api/academia-sdr/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: id, type: d.type, no: d.no, score: d.score, total: d.total }),
      }).then(() => loadTracking(id));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [clientId]);

  async function upload(file: File) {
    if (!clientId) return;
    setUploading(true);
    setError(null);
    try {
      const html = await file.text();
      const r = await fetch(`/api/academia-sdr?client_id=${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, sourceUrl }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo subir el entrenamiento");
      await loadClient(clientId);
      loadCoverage();
      setTab("capacitacion");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeUpload() {
    if (!clientId || !confirm("¿Quitar el entrenamiento subido? El avance registrado de los SDR se conserva.")) return;
    const r = await fetch(`/api/academia-sdr?client_id=${clientId}`, { method: "DELETE" });
    if (!r.ok) {
      setError("No se pudo quitar el entrenamiento subido");
      return;
    }
    await loadClient(clientId);
    loadCoverage();
  }

  const missing = (coverage ?? []).filter((c) => !c.origin);
  const withTraining = (coverage ?? []).filter((c) => c.origin);

  function selectClient(id: string) {
    const c = clients.find((x) => x.id === id);
    if (c) setCurrentClient(c);
  }

  // ?client_id= (link desde el Onboarding SDR): abre ese cliente.
  const urlClientDone = useRef(false);
  useEffect(() => {
    if (urlClientDone.current || !clients.length) return;
    urlClientDone.current = true;
    const id = new URLSearchParams(window.location.search).get("client_id");
    if (id) selectClient(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients]);

  const missingAlert = missing.length > 0 && (
    <div className="card border border-warning-bg bg-warning-bg/40 text-sm space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-warning-fg font-medium">
          <IconAlertTriangle size={18} className="shrink-0" />
          {missing.length} cliente(s) activo(s) sin Entrenamiento cliente
        </div>
        {clientId && (
          <button className="text-xs underline text-ink-muted" onClick={() => setShowMissing((v) => !v)}>
            {showMissing ? "Ocultar" : "Ver cuáles"}
          </button>
        )}
      </div>
      {(showMissing || !clientId) && (
        <div className="flex flex-wrap gap-1.5">
          {missing.map((c) => (
            <button key={c.id} onClick={() => selectClient(c.id)} className="px-2.5 py-1 rounded-full bg-white border border-warning-bg text-xs hover:border-brand">
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const header = (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="label">SDR</div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconSchool size={24} /> Entrenamiento cliente
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          {clientId
            ? `Capacitación de ${currentClient?.name} para los SDR, la misma del proyecto de Claude del cliente.`
            : "Capacitación por cliente para los SDR, la misma del proyecto de Claude de cada cliente."}
        </p>
      </div>
      {clientId && training && (
        <a className="btn-secondary flex items-center gap-1.5" href={`/api/academia-sdr/html?client_id=${clientId}&download=1`}>
          <IconDownload size={15} /> Descargar .html
        </a>
      )}
    </header>
  );

  // Sin cliente elegido: resumen de qué clientes tienen entrenamiento.
  if (!clientId) {
    return (
      <div className="space-y-6">
        {header}
        {missingAlert}
        <div className="card space-y-3">
          <h2 className="font-semibold">Con Entrenamiento cliente ({withTraining.length})</h2>
          {coverage === null ? (
            <div className="flex items-center gap-2 text-ink-muted text-sm">
              <IconLoader2 size={16} className="animate-spin" /> Cargando…
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {withTraining.map((c) => (
                <button key={c.id} onClick={() => selectClient(c.id)} className="px-2.5 py-1 rounded-full bg-brand-tint text-xs hover:underline flex items-center gap-1">
                  <IconCheck size={12} /> {c.name}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-ink-subtle">Elige un cliente (aquí o en el selector de la barra lateral) para ver su entrenamiento y el seguimiento de los SDR.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {error && (
        <div className="card text-danger-fg flex items-center gap-2 text-sm">
          <IconAlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="flex gap-1 border-b border-[#EEEAF6]">
        {([
          ["capacitacion", "Capacitación", IconSchool],
          ["seguimiento", "Seguimiento", IconChartBar],
          ["configurar", "Configurar", IconSettings],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 -mb-px ${tab === key ? "border-brand text-brand font-medium" : "border-transparent text-ink-muted"}`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="card flex items-center gap-3 text-ink-muted">
          <IconLoader2 size={18} className="animate-spin" /> Cargando…
        </div>
      )}

      {/* Alerta: el cliente aún no tiene entrenamiento */}
      {!loading && !training && tab !== "seguimiento" && (
        <div className="card border-2 border-warning-bg bg-warning-bg/30 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-warning-fg">
            <IconAlertTriangle size={20} /> {currentClient?.name} todavía no tiene Entrenamiento cliente
          </div>
          <ol className="list-decimal pl-5 text-sm space-y-1">
            <li>
              En el proyecto de Claude de {currentClient?.name}, pide <b>«crea el entrenamiento cliente»</b> (skill <code>academia-sdr-bullseye</code>). Usa los documentos que ya están en el proyecto.
            </li>
            <li>Descarga el archivo <b>.html</b> que entrega el skill.</li>
            <li>
              Súbelo en <button className="underline" onClick={() => setTab("configurar")}>Configurar</button>. Queda disponible para los SDR al instante.
            </li>
          </ol>
        </div>
      )}

      {tab === "capacitacion" && !loading && training && srcDoc && (
        <>
          {!training.tracking && (
            <div className="card text-sm text-warning-fg bg-warning-bg/30 flex items-center gap-2">
              <IconAlertTriangle size={16} className="shrink-0" />
              Este entrenamiento se hizo con una versión anterior del skill: se puede usar, pero no registra las vueltas completadas. Vuelve a generarlo con el skill actualizado para tener seguimiento.
            </div>
          )}
          <div className="card p-0 overflow-hidden">
            <iframe
              ref={iframeRef}
              title={training.title}
              srcDoc={srcDoc}
              className="w-full block"
              style={{ height: "85vh", border: 0 }}
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              allow="clipboard-write"
            />
          </div>
        </>
      )}

      {tab === "seguimiento" && !loading && (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-muted border-b border-[#EEEAF6]">
                <th className="px-4 py-2 font-medium">SDR</th>
                <th className="px-4 py-2 font-medium">Líder</th>
                <th className="px-4 py-2 font-medium text-right">Ingresos</th>
                <th className="px-4 py-2 font-medium">Último ingreso</th>
                <th className="px-4 py-2 font-medium">Vueltas</th>
                <th className="px-4 py-2 font-medium">Quiz</th>
                <th className="px-4 py-2 font-medium">Última vuelta</th>
              </tr>
            </thead>
            <tbody>
              {tracking.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink-muted">
                    Nadie ha ingresado todavía al entrenamiento de este cliente.
                  </td>
                </tr>
              )}
              {tracking.map((r) => {
                const passed = r.quizScore != null && r.quizTotal ? r.quizScore >= Math.ceil(r.quizTotal * 0.8) : false;
                return (
                  <tr key={r.email} className="border-b border-[#EEEAF6] last:border-0">
                    <td className="px-4 py-2">
                      <div className="font-medium">{r.sdrName ?? r.email}</div>
                      {r.sdrName && <div className="text-xs text-ink-subtle">{r.email}</div>}
                    </td>
                    <td className="px-4 py-2">{r.leaderName ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.visits}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{fmtDate(r.lastVisit)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1" title={r.completed.map((n) => `Vuelta ${n}`).join(", ") || "Ninguna"}>
                        {LAPS.map((n) => (
                          <span key={n} className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: r.completed.includes(n) ? "#62E0D8" : "#E4E0F2" }} />
                        ))}
                        <span className="ml-2 tabular-nums text-ink-muted">
                          {r.completed.length}/{LAP_COUNT}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {r.quizScore != null ? (
                        <span className={passed ? "text-success-fg" : "text-danger-fg"}>
                          {r.quizScore}/{r.quizTotal} {passed ? "✓" : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{fmtDate(r.lastCompletedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-ink-subtle px-4 py-3 border-t border-[#EEEAF6]">
            Se registra el avance hecho dentro de la plataforma (no el del .html descargado). Al completar una vuelta por primera vez se avisa por correo a la líder de célula del SDR, con copia a Ingri. El puntaje del quiz solo llega en los entrenamientos hechos con el skill actualizado.
          </p>
        </div>
      )}

      {tab === "configurar" && !loading && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card space-y-3">
            <h2 className="font-semibold">Entrenamiento actual</h2>
            {training ? (
              <dl className="text-sm space-y-2">
                <div>
                  <dt className="label">Título</dt>
                  <dd>{training.title}</dd>
                </div>
                <div>
                  <dt className="label">Origen</dt>
                  <dd>
                    {training.origin === "proyecto"
                      ? "Proyecto de Claude del cliente (conectado en la plataforma)"
                      : `Subido por ${training.uploadedBy ?? "—"} el ${fmtDate(training.uploadedAt)}`}
                  </dd>
                </div>
                {training.sourceUrl && (
                  <div>
                    <dt className="label">En Claude</dt>
                    <dd>
                      <a href={training.sourceUrl} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">
                        Abrir en Claude <IconExternalLink size={13} />
                      </a>
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="label">Seguimiento de vueltas</dt>
                  <dd>{training.tracking ? "Sí" : "No (hecho con una versión anterior del skill)"}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink-muted">Este cliente todavía no tiene entrenamiento.</p>
            )}
            {training?.origin === "subido" && (
              <button className="btn-secondary flex items-center gap-1.5 text-sm" onClick={() => void removeUpload()}>
                <IconTrash size={14} /> Quitar el subido{training.hasProjectVersion ? " (vuelve al del proyecto)" : ""}
              </button>
            )}
          </div>

          <div className="card space-y-3">
            <h2 className="font-semibold">{training ? "Reemplazar entrenamiento" : "Subir entrenamiento"}</h2>
            <p className="text-sm text-ink-muted">
              Sube el <b>.html</b> que entrega el skill <code>academia-sdr-bullseye</code> en el proyecto de Claude de {currentClient?.name}. Se muestra tal cual, con su diseño, y reemplaza al actual. El avance de los SDR se conserva.
            </p>
            <div>
              <label className="label block mb-1">Link del artifact en Claude (opcional)</label>
              <input className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://claude.ai/artifact/…" disabled={uploading} />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".html,.htm,text/html"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <button className="btn-primary flex items-center gap-2" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <IconLoader2 size={15} className="animate-spin" /> : <IconUpload size={15} />}
              {uploading ? "Subiendo…" : "Elegir archivo .html"}
            </button>
          </div>
        </div>
      )}

      {missingAlert}
    </div>
  );
}
