"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  IconAlertCircle,
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

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAcademy(null);
    setStates({});
    setModErrors({});
    fetch(`/api/academia-sdr?client_id=${clientId}`)
      .then(async (r) => {
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(data.error || "No se pudo cargar la academia");
        setAcademy(data.academy);
        setMaterials(data.materials);
        setInputs(data.academy.inputs);
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
    () => (modules.length && currentClient ? renderAcademyHtml({ clientName: currentClient.name, clientKey: currentClient.slug, modules }) : ""),
    [modules, currentClient]
  );

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
          <div className="label">Análisis · SDR</div>
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

      {loading ? (
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
      )}

      {openQuestions.length > 0 && (
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

      {html && (
        <div className="card p-0 overflow-hidden">
          <iframe title="Academia SDR" srcDoc={html} className="w-full block" style={{ height: "80vh", border: 0 }} sandbox="allow-scripts allow-same-origin allow-popups" />
        </div>
      )}
    </div>
  );
}
