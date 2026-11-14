"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconCopy, IconLoader2, IconRefresh, IconSparkles } from "@tabler/icons-react";
import type { KamConversation, KamInsightsDoc, KamSource } from "@/lib/radarAbm/server/kamInsights";

// Pulso ABM → Inteligencia (KAM), arriba de todo: insights del feedback del
// cliente y de Peitho (IA) + conversaciones para tener con el cliente, con su
// seguimiento (pendiente / conversado / descartado + nota). Solo vista interna.

const SRC: Record<KamSource, string> = { feedback: "Feedback", peitho: "Peitho", ambos: "Feedback + Peitho" };
const TIPO: Record<string, string> = { oportunidad: "Oportunidad", riesgo: "Riesgo", icp: "ICP", mensaje: "Mensaje", proceso: "Proceso" };
const TIPO_C: Record<string, string> = { oportunidad: "var(--good)", riesgo: "var(--bad)", icp: "var(--teal)", mensaje: "var(--magenta)", proceso: "var(--accent)" };
const PRIO_C: Record<string, string> = { alta: "var(--bad-fg)", media: "var(--warn-fg)", baja: "var(--muted, #888)" };
const ESTADOS: KamConversation["estado"][] = ["pendiente", "conversado", "descartado"];
const fmt = (d: string) => new Date(d).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
const who = (by: string) => (by === "automático" ? "automático" : by);

export default function KamInsights({ clientId }: { clientId?: string | null }) {
  const [doc, setDoc] = useState<KamInsightsDoc | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    setDoc(undefined); setError(null);
    fetch(`/api/radar-abm/kam-insights?client_id=${clientId}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? "No se pudo cargar"); setDoc(j.doc ?? null); })
      .catch((e) => { setError(e.message); setDoc(null); });
  }, [clientId]);

  async function call(method: "POST" | "PATCH", body: Record<string, unknown>) {
    const r = await fetch("/api/radar-abm/kam-insights", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "No se pudo guardar");
    setDoc(j.doc);
  }
  async function generate() {
    setBusy(true); setError(null);
    try { await call("POST", {}); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (!clientId) return <div className="ra-kam ra-kam-meta">Elige un cliente para ver sus insights.</div>;
  if (doc === undefined) return <div className="ra-kam ra-kam-meta"><IconLoader2 size={14} className="inline animate-spin" /> Cargando…</div>;

  const open = (doc?.conversaciones ?? []).filter((c) => c.estado === "pendiente");
  const done = (doc?.conversaciones ?? []).filter((c) => c.estado !== "pendiente");

  return (
    <div className="ra-kam">
      <div className="ra-kam-head">
        <div>
          {doc ? (
            <p className="ra-kam-meta">
              Última versión: {fmt(doc.generated_at)} ({doc.generated_by === "automático" ? "automática" : `por ${doc.generated_by}`}) · {doc.sources.feedback} respuestas de feedback · {doc.sources.peitho} reuniones de Peitho
              {doc.sources.peitho_status !== "ok" && <> (Peitho: {doc.sources.peitho_status})</>}
              <br />Se actualiza solo cada día hábil cuando llega feedback nuevo o una reunión nueva de Peitho.
            </p>
          ) : (
            <p className="ra-kam-meta">Lee el feedback que dejó el cliente de cada reunión y el análisis de Peitho de los últimos 6 meses, y propone qué conversar con el cliente. Se genera solo cada día hábil cuando hay datos nuevos; también puedes generarlo ahora.</p>
          )}
        </div>
        <button className="ra-btn pri" onClick={generate} disabled={busy}>
          {busy ? <IconLoader2 size={15} className="animate-spin" /> : doc ? <IconRefresh size={15} /> : <IconSparkles size={15} />}
          {busy ? " Analizando (≈1 min)…" : doc ? " Actualizar ahora" : " Generar ahora"}
        </button>
      </div>
      {error && <p className="ra-kam-err">{error}</p>}

      {doc && (
        <>
          {doc.resumen && <p className="ra-kam-sum">{doc.resumen}</p>}

          {doc.insights.length > 0 && (
            <>
              <h4 className="ra-kam-h">Insights</h4>
              <div className="ra-kam-grid">
                {doc.insights.map((x) => (
                  <div key={x.id} className="ra-kam-ins" style={{ ["--c" as any]: TIPO_C[x.tipo] ?? "var(--accent)" }}>
                    <div className="ra-kam-tags"><span>{TIPO[x.tipo] ?? x.tipo}</span><span className="src">{SRC[x.fuente]}</span></div>
                    <b>{x.titulo}</b>
                    <p>{x.hallazgo}</p>
                    <p className="ev"><b>Dato:</b> {x.evidencia}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          <h4 className="ra-kam-h">Conversaciones con el cliente {open.length > 0 && <span className="ra-kam-n">{open.length} pendientes</span>}</h4>
          {open.length === 0 && <p className="ra-kam-meta">No hay conversaciones pendientes. Aparecerán nuevas cuando llegue feedback o reuniones de Peitho.</p>}
          {open.map((c) => <Conversation key={c.id} c={c} onSave={(p) => call("PATCH", { id: c.id, ...p })} />)}

          {done.length > 0 && (
            <details className="ra-fold" open={showDone} onToggle={(e) => setShowDone((e.target as HTMLDetailsElement).open)}>
              <summary>Historial · {done.length} conversadas o descartadas</summary>
              {done.map((c) => <Conversation key={c.id} c={c} onSave={(p) => call("PATCH", { id: c.id, ...p })} />)}
            </details>
          )}

          {(doc.history?.length ?? 0) > 0 && (
            <details className="ra-fold">
              <summary>Versiones anteriores de los insights · {doc.history!.length}</summary>
              {doc.history!.map((v, i) => (
                <details key={i} className="ra-kam-ver">
                  <summary>{fmt(v.at)} · {v.by === "automático" ? "automática" : `por ${v.by}`} · {v.feedback} feedback · {v.peitho} Peitho</summary>
                  {v.resumen && <p className="ra-kam-why">{v.resumen}</p>}
                  <ul>{v.insights.map((x) => <li key={x.id}><b>{x.titulo}:</b> {x.hallazgo}</li>)}</ul>
                </details>
              ))}
            </details>
          )}
        </>
      )}
    </div>
  );
}

function Conversation({ c, onSave }: { c: KamConversation; onSave: (p: { estado?: string; nota?: string }) => Promise<void> }) {
  const [nota, setNota] = useState(c.nota ?? "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setNota(c.nota ?? ""), [c.nota]);

  async function save(p: { estado?: string; nota?: string }) {
    setSaving(true); setErr(null);
    try { await onSave(p); } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  function copy() {
    navigator.clipboard?.writeText(c.mensaje).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }

  return (
    <div className={`ra-kam-conv${c.estado !== "pendiente" ? " done" : ""}`}>
      <div className="ra-kam-conv-top">
        <b>{c.tema}</b>
        <span className="ra-kam-prio" style={{ color: PRIO_C[c.prioridad] }}>Prioridad {c.prioridad}</span>
        <span className="ra-kam-tags"><span className="src">{SRC[c.fuente]}</span></span>
      </div>
      <p className="ra-kam-why">{c.por_que}</p>
      <p><b>Pregunta para el cliente:</b> {c.pregunta}</p>
      <div className="ra-kam-msg">
        <p>{c.mensaje}</p>
        <button className="ra-btn" onClick={copy} title="Copiar mensaje">{copied ? <IconCheck size={14} /> : <IconCopy size={14} />} {copied ? "Copiado" : "Copiar mensaje"}</button>
      </div>
      <div className="ra-kam-actions">
        <select className="ra-select" value={c.estado} disabled={saving} onChange={(e) => save({ estado: e.target.value, nota })}>
          {ESTADOS.map((s) => <option key={s} value={s}>{s === "pendiente" ? "Pendiente" : s === "conversado" ? "Conversado con el cliente" : "Descartado"}</option>)}
        </select>
        <input className="ra-input" placeholder="Qué respondió el cliente / acuerdos" value={nota} onChange={(e) => setNota(e.target.value)} />
        <button className="ra-btn" disabled={saving || nota === (c.nota ?? "")} onClick={() => save({ nota })}>{saving ? "Guardando…" : "Guardar nota"}</button>
      </div>
      {(c.log?.length ?? 0) > 0 ? (
        <details className="ra-kam-log">
          <summary>Trazabilidad · {c.log!.length} {c.log!.length === 1 ? "registro" : "registros"}{c.updated_at ? ` · último ${fmt(c.updated_at)}` : ""}</summary>
          <ul>{[...c.log!].reverse().map((l, i) => <li key={i}>{fmt(l.at)} · {who(l.by)} · {l.accion}</li>)}</ul>
        </details>
      ) : c.updated_by ? (
        <p className="ra-kam-meta">Actualizado por {c.updated_by} · {fmt(c.updated_at!)}</p>
      ) : null}
      {err && <p className="ra-kam-err">{err}</p>}
    </div>
  );
}
