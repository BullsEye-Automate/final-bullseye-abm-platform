"use client";

import { useState } from "react";
import {
  IconCloudUpload,
  IconCheck,
  IconAlertCircle,
  IconTargetArrow,
  IconActivity
} from "@tabler/icons-react";

type SetupResult = {
  properties: {
    contacts: { ok: boolean; created: string[]; errors: Array<{ property: string; error: string }> };
    companies: { ok: boolean; created: string[]; errors: Array<{ property: string; error: string }> };
  };
  lists: Array<{
    name: string;
    ok: boolean;
    created: boolean;
    listId?: string;
    error?: string;
    debug?: unknown;
  }>;
  summary: {
    total: number;
    created: number;
    already_existed: number;
    failed: number;
  };
};

type BackfillSummary = {
  processed: number;
  scored?: number;
  synced?: number;
  hubspot_synced?: number;
  errors: number;
  remaining_in_queue?: number;
};

export default function HubspotConfigPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [backfillFitLoading, setBackfillFitLoading] = useState(false);
  const [backfillFitResult, setBackfillFitResult] = useState<BackfillSummary | null>(null);
  const [backfillEngagementLoading, setBackfillEngagementLoading] = useState(false);
  const [backfillEngagementResult, setBackfillEngagementResult] = useState<BackfillSummary | null>(
    null
  );

  async function runSetup() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/hubspot/setup-lists", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function runBackfillFit() {
    setBackfillFitLoading(true);
    setBackfillFitResult(null);
    try {
      const res = await fetch("/api/contacts/backfill-fit-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setBackfillFitResult(data.summary);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBackfillFitLoading(false);
    }
  }

  async function runBackfillEngagement() {
    setBackfillEngagementLoading(true);
    setBackfillEngagementResult(null);
    try {
      const res = await fetch("/api/contacts/backfill-engagement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setBackfillEngagementResult(data.summary);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBackfillEngagementLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="label">Sistema · Configuración</div>
        <h1 className="text-2xl font-semibold tracking-tight">HubSpot — Setup inicial</h1>
        <div className="text-sm text-ink-muted mt-1 max-w-2xl">
          Crea las custom properties wecad_* y las 7 listas dinámicas que el SDR
          usa día a día. Idempotente: si ya existen, no las duplica.
        </div>
      </header>

      <div className="card p-4 space-y-3">
        <div className="text-sm text-ink-muted">
          Esto crea (si no existen):
          <ul className="list-disc ml-5 mt-1 space-y-0.5">
            <li>Properties de contacto: <code>wecad_phone_lemlist</code>, <code>wecad_phone_lusha</code>, <code>wecad_callback_date</code>, <code>wecad_qualification_outcome</code>, etc.</li>
            <li>7 listas dinámicas: Hot por llamar, Hot sin teléfono (Lusha), Warm por llamar, Warm sin teléfono (Lusha), Reintentar, Callbacks de hoy, En pipeline</li>
          </ul>
        </div>
        <button onClick={runSetup} disabled={loading} className="btn-primary">
          <IconCloudUpload size={16} />
          {loading ? "Sincronizando con HubSpot…" : "Crear properties + listas"}
        </button>
        {error && (
          <div className="text-sm text-danger-fg flex items-center gap-2">
            <IconAlertCircle size={14} /> {error}
          </div>
        )}
      </div>

      {/* Backfill: fit_score con Claude para contactos sin scoring de Clay. */}
      <div className="card p-4 space-y-3">
        <div className="flex items-start gap-2">
          <IconTargetArrow size={18} className="text-brand shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold">Backfill: fit_score con IA</h2>
            <div className="text-sm text-ink-muted mt-1">
              Los contactos que vinieron por Sales Nav / web scrape / manual
              import bypasean el Lead Scoring de Clay y quedan sin fit_score
              → no matchean las listas Hot/Warm. Este botón los recorre y
              les asigna score con Claude (mismos criterios que Clay), luego
              re-sincroniza a HubSpot.
              <br />
              <span className="text-ink-subtle text-xs">
                Procesa hasta 25 por corrida. Si remaining &gt; 0, repite.
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={runBackfillFit}
          disabled={backfillFitLoading}
          className="btn-primary"
        >
          <IconTargetArrow size={16} />
          {backfillFitLoading ? "Scoring…" : "Calcular fit_score faltante"}
        </button>
        {backfillFitResult && (
          <div className="text-sm bg-success-bg/30 rounded-md p-2">
            <strong>Procesados:</strong> {backfillFitResult.processed} ·{" "}
            <strong>Scoreados:</strong> {backfillFitResult.scored ?? 0} ·{" "}
            <strong>Sincronizados a HubSpot:</strong>{" "}
            {backfillFitResult.hubspot_synced ?? 0}
            {backfillFitResult.errors > 0 && (
              <span className="text-danger-fg">
                {" "}
                · {backfillFitResult.errors} errores
              </span>
            )}
            {backfillFitResult.remaining_in_queue! > 0 && (
              <div className="text-warning-fg mt-1">
                Quedan {backfillFitResult.remaining_in_queue} más — repite el botón.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Backfill: engagement_score para contactos ya en HubSpot. */}
      <div className="card p-4 space-y-3">
        <div className="flex items-start gap-2">
          <IconActivity size={18} className="text-brand shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold">Backfill: engagement_score</h2>
            <div className="text-sm text-ink-muted mt-1">
              Re-sincroniza a HubSpot todos los contactos para poblar la
              nueva property <code>wecad_engagement_score</code> (0-100,
              calculado desde lemlist_activities + calls). Necesario una
              sola vez después de crear la property nueva. Los pushes
              normales (al aprobar a Lemlist) ya incluyen el score
              actualizado.
              <br />
              <span className="text-ink-subtle text-xs">
                Procesa hasta 30 por corrida. Si remaining &gt; 0, repite.
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={runBackfillEngagement}
          disabled={backfillEngagementLoading}
          className="btn-primary"
        >
          <IconActivity size={16} />
          {backfillEngagementLoading
            ? "Sincronizando…"
            : "Recalcular engagement de todos"}
        </button>
        {backfillEngagementResult && (
          <div className="text-sm bg-success-bg/30 rounded-md p-2">
            <strong>Procesados:</strong> {backfillEngagementResult.processed} ·{" "}
            <strong>Sincronizados:</strong> {backfillEngagementResult.synced ?? 0}
            {backfillEngagementResult.errors > 0 && (
              <span className="text-danger-fg">
                {" "}
                · {backfillEngagementResult.errors} errores
              </span>
            )}
            {backfillEngagementResult.remaining_in_queue! > 0 && (
              <div className="text-warning-fg mt-1">
                Quedan {backfillEngagementResult.remaining_in_queue} más — repite el
                botón.
              </div>
            )}
          </div>
        )}
      </div>

      {result && (
        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="font-semibold mb-2 flex items-center gap-2">
              <IconCheck size={16} className="text-success-fg" /> Resumen
            </h2>
            <div className="text-sm space-y-0.5">
              <div>Total listas: {result.summary.total}</div>
              <div>Creadas ahora: {result.summary.created}</div>
              <div>Ya existían: {result.summary.already_existed}</div>
              <div>
                Fallidas:{" "}
                <span className={result.summary.failed > 0 ? "text-danger-fg font-medium" : ""}>
                  {result.summary.failed}
                </span>
              </div>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="font-semibold mb-2">Custom properties</h2>
            <div className="text-sm space-y-3">
              <div>
                <div className="font-medium">Contactos</div>
                <PropList
                  created={result.properties.contacts.created}
                  errors={result.properties.contacts.errors}
                />
              </div>
              <div>
                <div className="font-medium">Empresas</div>
                <PropList
                  created={result.properties.companies.created}
                  errors={result.properties.companies.errors}
                />
              </div>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="font-semibold mb-2">Listas dinámicas</h2>
            <div className="text-sm space-y-2">
              {result.lists.map((l) => (
                <div key={l.name} className="border-b border-divider last:border-0 py-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{l.name}</div>
                    {l.ok ? (
                      <span className="badge bg-success-bg text-success-fg">
                        {l.created ? "creada" : "ya existía"}
                      </span>
                    ) : (
                      <span className="badge bg-danger-bg text-danger-fg">error</span>
                    )}
                  </div>
                  {l.listId && (
                    <div className="text-xs text-ink-muted mt-0.5">listId: {l.listId}</div>
                  )}
                  {l.error && <div className="text-xs text-danger-fg mt-1">{l.error}</div>}
                  {l.debug != null && (
                    <details className="text-[10px] mt-1">
                      <summary className="cursor-pointer text-ink-muted">Ver debug</summary>
                      <pre className="bg-ink-muted/10 p-2 rounded mt-1 overflow-auto">
                        {JSON.stringify(l.debug, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PropList({
  created,
  errors
}: {
  created: string[];
  errors: Array<{ property: string; error: string }>;
}) {
  return (
    <div className="text-xs text-ink-muted ml-3 mt-0.5 space-y-0.5">
      <div>
        Creadas ahora: {created.length > 0 ? created.join(", ") : "ninguna (ya existían todas)"}
      </div>
      {errors.length > 0 && (
        <div className="text-danger-fg">
          Errores: {errors.map((e) => `${e.property} (${e.error})`).join(", ")}
        </div>
      )}
    </div>
  );
}
