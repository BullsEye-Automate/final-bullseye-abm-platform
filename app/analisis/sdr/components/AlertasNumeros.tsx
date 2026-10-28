"use client";

// Sección "Alertas de Números" de Análisis SDR: semáforo por número de Allo
// (últimos 7 días vs su promedio de 4 semanas). Reglas en
// lib/phoneHealth/engine.ts; el mismo cálculo se envía por correo cada día
// hábil a las 8:00 (cron /api/cron/alertas-numeros).
import { useEffect, useState } from "react";
import { IconAlertTriangle, IconAlertCircle, IconLoader2, IconMail, IconRefresh } from "@tabler/icons-react";

type Level = "red" | "yellow" | "watch" | "ok" | "low_volume";
type NumberHealth = {
  number: string;
  name: string;
  client: string;
  country: string;
  level: Level;
  reasons: string[];
  action: string;
  dials7: number;
  rate7: number | null;
  rateBase: number | null;
  dropPct: number | null;
  voicemailShare7: number | null;
};
type Report = {
  today: string;
  windows: { current: [string, string]; baseline: [string, string] };
  numbers: NumberHealth[];
  counts: Record<Level, number>;
  dataWarning: string | null;
  since: Record<string, string>;
  recipients: string[];
};

const LEVEL: Record<Level, { label: string; cls: string }> = {
  red: { label: "Rojo", cls: "bg-red-600 text-white" },
  yellow: { label: "Amarillo", cls: "bg-amber-400 text-gray-900" },
  watch: { label: "Vigilar", cls: "bg-indigo-100 text-indigo-900" },
  ok: { label: "Sano", cls: "bg-emerald-100 text-emerald-900" },
  low_volume: { label: "Sin volumen", cls: "bg-gray-100 text-gray-600" },
};

const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1).replace(".", ",")}%`);

export default function AlertasNumeros() {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analisis/alertas-numeros");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Error al cargar alertas");
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function sendNow() {
    setSending(true);
    setSendMsg(null);
    try {
      const res = await fetch("/api/analisis/alertas-numeros", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se pudo enviar");
      setSendMsg(json.sent ? `Correo enviado a ${json.to.join(", ")}` : `No se envió: ${json.reason}`);
    } catch (e) {
      setSendMsg((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const alerts = data?.numbers.filter((n) => n.level === "red" || n.level === "yellow") ?? [];
  const rows = showAll ? data?.numbers ?? [] : alerts;

  return (
    <section id="alertas-numeros" className="card space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b">
        <h2 className="font-semibold flex items-center gap-2">
          <IconAlertTriangle size={16} className="text-brand" /> Alertas de Números
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={sendNow}
            disabled={sending || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border hover:bg-black/5 transition disabled:opacity-50"
          >
            {sending ? <IconLoader2 size={15} className="animate-spin" /> : <IconMail size={15} />}
            Enviarme el correo ahora
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border hover:bg-black/5 transition disabled:opacity-50"
          >
            {loading ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />}
            Actualizar
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-muted">
        Cada número se compara contra su propio promedio de las 4 semanas anteriores (métrica: % de
        llamadas que contesta una persona). <b>Rojo</b>: bajo 5% dos semanas seguidas o caída de 40% o
        más. <b>Amarillo</b>: caída de 25–40%, más de 60% a buzón o aumento de conexiones de menos de 15 s.
        Se evalúa cada día hábil a las 8:00 y se avisa por correo
        {data?.recipients?.length ? ` a ${data.recipients.join(", ")}` : ""} cuando hay alertas nuevas o
        resueltas, y siempre los lunes.
      </p>
      {sendMsg && <p className="text-xs text-ink-muted">{sendMsg}</p>}

      {error && (
        <div className="flex items-center gap-2 text-error-fg text-sm p-3 rounded bg-error-bg/20 border border-error-bg">
          <IconAlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}
      {data?.dataWarning && (
        <div className="flex items-center gap-2 text-sm p-3 rounded bg-amber-50 border border-amber-300 text-amber-900">
          <IconAlertCircle size={16} className="shrink-0" />
          {data.dataWarning}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-12 text-ink-muted gap-2">
          <IconLoader2 size={18} className="animate-spin" />
          Evaluando números…
        </div>
      )}

      {data && (
        <>
          <div className="flex gap-3 flex-wrap">
            {(["red", "yellow", "watch", "ok", "low_volume"] as Level[]).map((l) => (
              <div key={l} className="flex items-center gap-2 text-sm">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${LEVEL[l].cls}`}>{LEVEL[l].label}</span>
                <span className="font-semibold">{data.counts[l]}</span>
              </div>
            ))}
            <span className="text-xs text-ink-muted self-center">
              Últimos 7 días: {data.windows.current[0]} a {data.windows.current[1]}
            </span>
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-ink-muted py-4">Ningún número en alerta. 🎉</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted border-b">
                    <th className="py-2 pr-3">Nivel</th>
                    <th className="py-2 pr-3">Número</th>
                    <th className="py-2 pr-3 text-right">Llamadas 7d</th>
                    <th className="py-2 pr-3 text-right">Contesta 7d</th>
                    <th className="py-2 pr-3 text-right">Base 4 sem.</th>
                    <th className="py-2 pr-3">Motivo y acción</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((n) => (
                    <tr key={n.number} className="border-b align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${LEVEL[n.level].cls}`}>
                          {LEVEL[n.level].label}
                        </span>
                        {data.since[n.number] && (
                          <div className="text-[11px] text-ink-muted mt-1">desde {data.since[n.number]}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{n.name}</div>
                        <div className="text-xs text-ink-muted">
                          {n.client} · {n.country} · {n.number}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right">{n.dials7}</td>
                      <td className="py-2 pr-3 text-right font-semibold">{pct(n.rate7)}</td>
                      <td className="py-2 pr-3 text-right">{pct(n.rateBase)}</td>
                      <td className="py-2 pr-3 text-xs">
                        {n.reasons.map((r, i) => (
                          <div key={i}>{r}</div>
                        ))}
                        {n.level !== "ok" && n.level !== "low_volume" && (
                          <div className="font-semibold mt-0.5">→ {n.action}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button onClick={() => setShowAll((v) => !v)} className="text-xs text-brand hover:underline">
            {showAll ? "Ver solo los números en alerta" : `Ver los ${data.numbers.length} números`}
          </button>
        </>
      )}
    </section>
  );
}
