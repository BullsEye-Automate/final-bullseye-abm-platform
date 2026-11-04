"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconChartBar,
  IconSettings,
  IconCheck,
  IconDownload,
  IconExternalLink,
  IconLoader2,
  IconRefresh,
  IconSchool,
  IconSparkles,
} from "@tabler/icons-react";
import { useClient, ALL_CLIENTS } from "@/lib/clientContext";
import { MODULES } from "@/lib/academiaSdr/modules";
import { renderAcademyHtml } from "@/lib/academiaSdr/render";
import { EMPTY_INPUTS, type AcademyInputs, type AcademyModule, type AcademyRecord } from "@/lib/academiaSdr/types";

type ModState = "idle" | "running" | "error";
type Tab = "capacitacion" | "seguimiento" | "configurar";

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

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Cuántos módulos se generan a la vez (el 1 va solo primero: deja cacheado
// el contexto del cliente para los demás).
const CONCURRENCY = 3;

export default function AcademiaSdrPage() {
  const { currentClient } = useClient();
  const clientId = currentClient && currentClient.id !== ALL_CLIENTS.id ? currentClient.id : null;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [academy, setAcademy] = useState<AcademyRecord | null>(null);
  const [materials, setMaterials] = useState<{ docCount: number; hasIcp: boolean } | null>(null);
  const [inputs, setInputs] = useState<AcademyInputs>(EMPTY_INPUTS);
  const [states, setStates] = useState<Record<number, ModState>>({});
  const [modErrors, setModErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("capacitacion");
  // Vueltas ya completadas por el usuario (se cargan una vez: si cambiaran
  // en cada evento el iframe se recargaría).
  const [seedDone, setSeedDone] = useState<number[]>([]);
  const [tracking, setTracking] = useState<TrackingRow[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const visitedFor = useRef<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "seguimiento" || t === "configurar") setTab(t);
  }, []);

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

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAcademy(null);
    setStates({});
    setModErrors({});
    setSeedDone([]);
    setTracking([]);
    Promise.all([fetch(`/api/academia-sdr?client_id=${clientId}`), loadTracking(clientId, true)])
      .then(async ([r]) => {
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(data.error || "No se pudo cargar la academia");
        setAcademy(data.academy);
        setMaterials(data.materials);
        setInputs(data.academy.inputs);
        if (!data.academy.modules.some(Boolean)) setTab((t) => (t === "capacitacion" ? "configurar" : t));
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const modules = useMemo(() => (academy?.modules ?? []).filter((m): m is AcademyModule => m !== null), [academy]);
  const readyCount = modules.length;
  const openQuestions = useMemo(() => modules.flatMap((m) => (m.openQuestions ?? []).map((q) => ({ no: m.no, q }))), [modules]);
  const html = useMemo(
    () => (modules.length && currentClient ? renderAcademyHtml({ clientName: currentClient.name, clientKey: currentClient.slug, modules, completed: seedDone }) : ""),
    [modules, currentClient, seedDone]
  );

  // Registra un ingreso cada vez que se abre la capacitación de un cliente.
  useEffect(() => {
    if (!clientId || !html || tab !== "capacitacion" || visitedFor.current === clientId) return;
    visitedFor.current = clientId;
    void fetch("/api/academia-sdr/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, type: "visit" }),
    });
  }, [clientId, html, tab]);

  // El HTML de la academia avisa (postMessage) cuando se completa una vuelta
  // o se responde el quiz; se registra y, la primera vez que se completa una
  // vuelta, el servidor avisa por correo a la líder del SDR.
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

  async function saveInputs(): Promise<boolean> {
    const r = await fetch(`/api/academia-sdr?client_id=${clientId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(data.error || "No se pudieron guardar los datos");
      return false;
    }
    return true;
  }

  async function runModule(no: number): Promise<void> {
    setStates((s) => ({ ...s, [no]: "running" }));
    setModErrors((e) => ({ ...e, [no]: "" }));
    try {
      const r = await fetch("/api/academia-sdr/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, module_no: no }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
      setAcademy((a) => {
        if (!a) return a;
        const mods = a.modules.slice();
        mods[no - 1] = data.module;
        return { ...a, modules: mods, generatedAt: new Date().toISOString() };
      });
      setStates((s) => ({ ...s, [no]: "idle" }));
    } catch (e) {
      setStates((s) => ({ ...s, [no]: "error" }));
      setModErrors((x) => ({ ...x, [no]: (e as Error).message }));
    }
  }

  async function generate(nos: number[]) {
    if (!clientId || busy) return;
    if (!inputs.focusService.trim() || !inputs.countries.trim()) {
      setError("Completa el servicio foco y los países de esta fase");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (!(await saveInputs())) return;
      const queue = nos.slice();
      if (queue[0] === 1) await runModule(queue.shift()!);
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length) await runModule(queue.shift()!);
      });
      await Promise.all(workers);
    } finally {
      setBusy(false);
    }
  }

  function generateAll() {
    if (readyCount && !confirm("Esto vuelve a generar los 10 módulos y reemplaza la academia actual. ¿Continuar?")) return;
    void generate(MODULES.map((m) => m.no));
  }

  function openInTab() {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  if (!clientId) {
    return (
      <div className="card flex items-center gap-3 text-warning-fg border border-warning-bg bg-warning-bg/40 text-sm max-w-xl">
        <IconAlertCircle size={18} className="shrink-0" />
        Elige un cliente en el selector de la barra lateral para ver o crear su Academia SDR.
      </div>
    );
  }

  const field = (key: keyof AcademyInputs, label: string, placeholder: string, opts: { required?: boolean; area?: boolean } = {}) => (
    <div>
      <label className="label block mb-1">
        {label}
        {opts.required ? " *" : ""}
      </label>
      {opts.area ? (
        <textarea
          className="input min-h-[80px]"
          value={inputs[key]}
          placeholder={placeholder}
          disabled={busy}
          onChange={(e) => setInputs((x) => ({ ...x, [key]: e.target.value }))}
        />
      ) : (
        <input
          className="input"
          value={inputs[key]}
          placeholder={placeholder}
          disabled={busy}
          onChange={(e) => setInputs((x) => ({ ...x, [key]: e.target.value }))}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">SDR</div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconSchool size={24} /> Academia SDR
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Capacitación de {currentClient?.name} para SDRs nuevos: 10 vueltas generadas con IA desde su Contexto IA e ICP.
          </p>
        </div>
        {html && (
          <div className="flex gap-2">
            <button className="btn-secondary flex items-center gap-1.5" onClick={openInTab}>
              <IconExternalLink size={15} /> Abrir en pestaña
            </button>
            <a className="btn-primary flex items-center gap-1.5" href={`/api/academia-sdr/html?client_id=${clientId}`}>
              <IconDownload size={15} /> Descargar .html
            </a>
          </div>
        )}
      </header>

      {error && (
        <div className="card text-danger-fg flex items-center gap-2 text-sm">
          <IconAlertCircle size={16} /> {error}
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

      {tab === "configurar" && (loading ? (
        <div className="card flex items-center gap-3 text-ink-muted">
          <IconLoader2 size={18} className="animate-spin" /> Cargando…
        </div>
      ) : (
        academy && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="card space-y-4">
              <h2 className="font-semibold">Foco de la campaña</h2>
              {materials && (
                <p className={`text-sm rounded-lg px-3 py-2 ${materials.docCount ? "bg-brand-tint text-ink-muted" : "bg-warning-bg text-warning-fg"}`}>
                  {materials.docCount
                    ? `La IA va a leer ${materials.docCount} documento(s) del cliente${materials.hasIcp ? ", incluido el ICP" : " (sin ICP cargado)"}.`
                    : "El cliente no tiene documentos de contexto ni ICP."}{" "}
                  <Link href="/configuracion/contexto" className="underline">
                    Ver Contexto IA
                  </Link>
                </p>
              )}
              {field("focusService", "Servicio foco", "Ej: Outsourcing de desarrollo de software", { required: true })}
              {field("countries", "Países de esta fase", "Ej: Chile, Perú, Colombia", { required: true })}
              {field("industries", "Industrias prioritarias", "Opcional: si no, se toman del ICP")}
              {field("notes", "Indicaciones para la IA", "Opcional: casos autorizados, cosas a evitar, tono…", { area: true })}
              <button className="btn-primary w-full flex items-center justify-center gap-2" onClick={generateAll} disabled={busy || !materials?.docCount}>
                {busy ? <IconLoader2 size={15} className="animate-spin" /> : <IconSparkles size={15} />}
                {busy ? "Generando…" : readyCount ? "Regenerar academia" : "Generar academia"}
              </button>
              <p className="text-xs text-ink-subtle">Tarda unos 3–5 minutos. Puedes regenerar una vuelta sola desde la lista.</p>
            </div>

            <div className="card space-y-2">
              <h2 className="font-semibold">
                Vueltas <span className="text-ink-muted font-normal text-sm">({readyCount} de {MODULES.length} listas)</span>
              </h2>
              <ul className="divide-y divide-[#EEEAF6]">
                {MODULES.map((def) => {
                  const mod = academy.modules[def.no - 1];
                  const st = states[def.no] ?? "idle";
                  return (
                    <li key={def.no} className="py-2 flex items-start gap-3 text-sm">
                      <span className="w-5 pt-0.5 shrink-0">
                        {st === "running" ? (
                          <IconLoader2 size={16} className="animate-spin text-brand" />
                        ) : st === "error" ? (
                          <IconAlertCircle size={16} className="text-danger-fg" />
                        ) : mod ? (
                          <IconCheck size={16} className="text-success-fg" />
                        ) : (
                          <span className="inline-block w-3 h-3 rounded-full border border-ink-subtle mt-0.5" />
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">
                          {def.no}. {mod?.title || def.title}
                        </div>
                        {modErrors[def.no] && <div className="text-xs text-danger-fg">{modErrors[def.no]}</div>}
                      </div>
                      <button
                        className="btn-secondary py-1 px-2 text-xs flex items-center gap-1"
                        disabled={busy || st === "running"}
                        onClick={() => void generate([def.no])}
                        title={mod ? "Regenerar esta vuelta" : "Generar esta vuelta"}
                      >
                        <IconRefresh size={13} /> {mod ? "Regenerar" : "Generar"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )
      ))}

      {tab === "configurar" && openQuestions.length > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold">Confirmar con el cliente antes de usar la capacitación</h2>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {openQuestions.map((o, i) => (
              <li key={i}>
                <span className="text-ink-subtle">Vuelta {o.no}:</span> {o.q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "capacitacion" && !loading && !html && (
        <div className="card text-center py-10">
          <IconSchool size={36} className="mx-auto mb-3 text-ink-subtle" />
          <p className="font-medium text-ink">La academia de {currentClient?.name} aún no está generada</p>
          <button className="btn-primary mt-4 mx-auto" onClick={() => setTab("configurar")}>
            Ir a Configurar
          </button>
        </div>
      )}

      {tab === "seguimiento" && (
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
                    Nadie ha ingresado todavía a la academia de este cliente.
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
                        {MODULES.map((m) => (
                          <span key={m.no} className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: r.completed.includes(m.no) ? "#62E0D8" : "#E4E0F2" }} />
                        ))}
                        <span className="ml-2 tabular-nums text-ink-muted">
                          {r.completed.length}/{MODULES.length}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {r.quizScore != null ? (
                        <span className={passed ? "text-success-fg" : "text-danger-fg"}>
                          {r.quizScore}/{r.quizTotal} {passed ? "✓" : ""}
                          <span className="text-xs text-ink-subtle"> · {r.quizAttempts} intento(s)</span>
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
            Solo se registra el avance hecho dentro de la plataforma (no el del .html descargado). Al completar una vuelta por primera vez se avisa por correo a la líder de célula del SDR, con copia a Ingri.
          </p>
        </div>
      )}

      {tab === "capacitacion" && html && (
        <div className="card p-0 overflow-hidden">
          <iframe ref={iframeRef} title="Academia SDR" srcDoc={html} className="w-full block" style={{ height: "80vh", border: 0 }} sandbox="allow-scripts allow-same-origin allow-popups" />
        </div>
      )}
    </div>
  );
}
