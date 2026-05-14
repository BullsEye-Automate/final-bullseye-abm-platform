"use client";

import { useState } from "react";
import {
  IconPhone,
  IconAlertCircle,
  IconCheck,
  IconExternalLink,
  IconSearch,
  IconRefresh
} from "@tabler/icons-react";

type RefreshPhonesResult = {
  ok: boolean;
  checked: number;
  phones_found: number;
  supabase_updated: number;
  hubspot_updated: number;
  not_in_hubspot: number;
  errors: number;
  sample_errors: string[];
  error?: string;
};

type LookupResult = {
  ok: boolean;
  status:
    | "not_found"
    | "phone_not_found"
    | "already_has_phone"
    | "enriched";
  linkedin_url: string;
  contact?: {
    source: "supabase" | "hubspot";
    name: string | null;
    hubspot_contact_id: string | null;
    supabase_contact_id: string | null;
    existing_phone: string | null;
    phone_lemlist: string | null;
    phone_lusha: string | null;
  };
  phone?: string | null;
  hubspot_updated?: boolean;
  supabase_updated?: boolean;
  lusha_debug?: unknown;
  hubspot_debug?: unknown;
  error?: string;
};

export default function TelefonosPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [forceLoading, setForceLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshPhonesResult | null>(null);

  async function runRefresh() {
    setRefreshLoading(true);
    setRefreshResult(null);
    try {
      const res = await fetch("/api/lemlist/refresh-phones", { method: "POST" });
      const data = await res.json();
      setRefreshResult(data);
    } catch (err) {
      setRefreshResult({
        ok: false,
        checked: 0,
        phones_found: 0,
        supabase_updated: 0,
        hubspot_updated: 0,
        not_in_hubspot: 0,
        errors: 0,
        sample_errors: [],
        error: err instanceof Error ? err.message : "Network error"
      });
    } finally {
      setRefreshLoading(false);
    }
  }

  async function run(force = false) {
    if (!url.trim()) return;
    if (force) setForceLoading(true);
    else setLoading(true);
    if (!force) setResult(null);
    try {
      const res = await fetch("/api/lusha-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_url: url.trim(), force })
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({
        ok: false,
        status: "not_found",
        linkedin_url: url,
        error: err instanceof Error ? err.message : "Network error"
      });
    } finally {
      setLoading(false);
      setForceLoading(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !loading) run(false);
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="label">SDR · Enrichment manual</div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconPhone size={22} /> Buscar teléfono con Lusha
        </h1>
        <div className="text-sm text-ink-muted mt-1 max-w-2xl">
          Pegá el LinkedIn URL del contacto. Lusha intenta levantar el
          teléfono (~1 crédito si encuentra) y lo escribe directo al contact
          de HubSpot. Si Lemlist ya había devuelto otro teléfono, lo
          conservamos en una propiedad separada para que puedas comparar.
        </div>
      </header>

      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium flex items-center gap-2">
              <IconRefresh size={16} /> Teléfonos de Lemlist → HubSpot
            </div>
            <div className="text-sm text-ink-muted mt-1 max-w-2xl">
              Todos los contactos que la app empuja a Lemlist ya salen con phone
              enrichment activado (<code>findPhone</code>), pero Lemlist tarda en
              levantar el número. Este botón recorre los contactos en campaña
              que todavía no tienen teléfono de Lemlist, se lo pide a Lemlist y
              lo escribe en Supabase y en HubSpot (campo <code>phone</code> +{" "}
              <code>wecad_phone_lemlist</code>). Correlo cada tanto — es
              idempotente.
            </div>
          </div>
          <button
            onClick={runRefresh}
            disabled={refreshLoading}
            className="btn-primary shrink-0"
          >
            <IconRefresh size={16} />
            {refreshLoading ? "Levantando…" : "Levantar teléfonos de Lemlist"}
          </button>
        </div>

        {refreshResult && (
          <div
            className={`text-sm rounded-md p-3 ${
              refreshResult.ok
                ? "bg-success-bg text-success-fg"
                : "bg-danger-bg text-danger-fg"
            }`}
          >
            {refreshResult.ok ? (
              <>
                <div className="font-medium flex items-center gap-1.5">
                  <IconCheck size={15} /> Listo
                </div>
                <ul className="mt-1 space-y-0.5 text-ink">
                  <li>
                    {refreshResult.checked} contactos consultados a Lemlist ·{" "}
                    {refreshResult.phones_found} con teléfono nuevo
                  </li>
                  <li>
                    {refreshResult.hubspot_updated} actualizados en HubSpot ·{" "}
                    {refreshResult.supabase_updated} en Supabase
                  </li>
                  {refreshResult.not_in_hubspot > 0 && (
                    <li className="text-warning-fg">
                      {refreshResult.not_in_hubspot} con teléfono pero sin
                      contacto en HubSpot (todavía no sincronizados)
                    </li>
                  )}
                  {refreshResult.errors > 0 && (
                    <li className="text-danger-fg">
                      {refreshResult.errors} errores
                      {refreshResult.sample_errors.length > 0 && (
                        <span>: {refreshResult.sample_errors.join("; ")}</span>
                      )}
                    </li>
                  )}
                </ul>
                {refreshResult.checked > 0 &&
                  refreshResult.phones_found === 0 && (
                    <div className="mt-1 text-ink-muted">
                      Lemlist todavía no tiene teléfonos nuevos para estos
                      contactos. Probá de nuevo más tarde.
                    </div>
                  )}
              </>
            ) : (
              <div className="flex items-center gap-1.5">
                <IconAlertCircle size={15} />
                {refreshResult.error ?? "La sincronización falló"}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <label className="text-sm font-medium">LinkedIn URL</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={onKey}
            placeholder="https://www.linkedin.com/in/usuario/"
            disabled={loading || forceLoading}
            className="input flex-1"
          />
          <button
            onClick={() => run(false)}
            disabled={loading || forceLoading || !url.trim()}
            className="btn-primary"
          >
            <IconSearch size={16} />
            {loading ? "Buscando…" : "Buscar"}
          </button>
        </div>
        <div className="text-xs text-ink-muted">
          Tip: aceptamos formato corto (linkedin.com/in/foo) o completo
          (https://www.linkedin.com/in/foo/). Si tiene parámetros de tracking
          (?utm=…) se ignoran.
        </div>
      </div>

      {result && (
        <ResultPanel
          result={result}
          onForce={() => run(true)}
          forceLoading={forceLoading}
        />
      )}
    </div>
  );
}

function ResultPanel({
  result,
  onForce,
  forceLoading
}: {
  result: LookupResult;
  onForce: () => void;
  forceLoading: boolean;
}) {
  if (result.status === "not_found") {
    return (
      <div className="card p-4 border-l-4 border-danger-fg">
        <div className="flex items-center gap-2 font-medium text-danger-fg">
          <IconAlertCircle size={16} /> Contacto no encontrado
        </div>
        <div className="text-sm text-ink-muted mt-1">
          {result.error ??
            "No encontré ese LinkedIn en Supabase ni en HubSpot. Verificá que el contacto haya pasado por la app."}
        </div>
        <div className="text-xs text-ink-muted mt-2">
          URL probada: <code>{result.linkedin_url}</code>
        </div>
      </div>
    );
  }

  if (result.status === "already_has_phone") {
    return (
      <div className="card p-4 border-l-4 border-success-fg space-y-3">
        <div className="flex items-center gap-2 font-medium text-success-fg">
          <IconCheck size={16} /> Ya tenía teléfono — no se llamó a Lusha
        </div>
        <ContactInfo result={result} />
        <PhonesPanel result={result} />
        <div className="pt-2 border-t border-divider">
          <button
            onClick={onForce}
            disabled={forceLoading}
            className="btn-secondary text-xs"
            title="Llama a Lusha de todas formas. Cuesta ~1 crédito Lusha si encuentra; gratis si no."
          >
            <IconSearch size={12} />
            {forceLoading
              ? "Buscando con Lusha…"
              : "Buscar también con Lusha (1 crédito si encuentra)"}
          </button>
          <div className="text-xs text-ink-muted mt-1">
            El número de arriba probablemente viene de Lemlist. Si querés un
            segundo número de Lusha para tener fallback, dale al botón.
          </div>
        </div>
      </div>
    );
  }

  if (result.status === "phone_not_found") {
    return (
      <div className="card p-4 border-l-4 border-warning-fg space-y-3">
        <div className="flex items-center gap-2 font-medium text-warning-fg">
          <IconAlertCircle size={16} /> Lusha no encontró teléfono
        </div>
        <ContactInfo result={result} />
        <PhonesPanel result={result} />
        <div className="text-sm text-ink-muted">
          Lusha respondió OK pero no devolvió phone para este contacto. No se
          cobró crédito (Lusha solo cobra cuando devuelve resultado).
        </div>
        {result.lusha_debug !== undefined && (
          <details className="text-xs">
            <summary className="cursor-pointer text-ink-muted">
              Ver respuesta cruda de Lusha
            </summary>
            <pre className="text-[10px] bg-ink-muted/10 p-2 rounded mt-1 overflow-auto">
              {JSON.stringify(result.lusha_debug, null, 2)}
            </pre>
          </details>
        )}
      </div>
    );
  }

  // enriched
  return (
    <div className="card p-4 border-l-4 border-success-fg space-y-3">
      <div className="flex items-center gap-2 font-medium text-success-fg">
        <IconCheck size={16} /> Teléfono encontrado y guardado
      </div>
      <ContactInfo result={result} />
      <PhonesPanel result={result} highlightLusha />
      <div className="text-xs text-ink-muted space-y-0.5">
        {result.hubspot_updated && <div>✓ Actualizado en HubSpot</div>}
        {result.supabase_updated && (
          <div>✓ Actualizado en weCAD-prospecting (Supabase)</div>
        )}
        {result.contact?.hubspot_contact_id && (
          <a
            href={`https://app.hubspot.com/contacts/contacts/${result.contact.hubspot_contact_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-brand mt-1"
          >
            Abrir en HubSpot <IconExternalLink size={11} />
          </a>
        )}
      </div>
      {result.hubspot_debug !== undefined && (
        <div>
          <div className="text-xs text-danger-fg">
            ⚠ HubSpot devolvió error al guardar:
          </div>
          <pre className="text-[10px] bg-ink-muted/10 p-2 rounded mt-1 overflow-auto">
            {JSON.stringify(result.hubspot_debug, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function PhonesPanel({
  result,
  highlightLusha
}: {
  result: LookupResult;
  highlightLusha?: boolean;
}) {
  const lemlist = result.contact?.phone_lemlist;
  const lusha = result.contact?.phone_lusha;
  const primary = result.phone ?? result.contact?.existing_phone ?? null;

  // Si no tenemos ningún teléfono explícito, mostramos solo el principal.
  if (!lemlist && !lusha && !primary) return null;

  return (
    <div className="space-y-1.5">
      {lemlist && (
        <PhoneRow
          label="Lemlist"
          number={lemlist}
          isPrimary={primary === lemlist && !highlightLusha}
        />
      )}
      {lusha && (
        <PhoneRow
          label="Lusha"
          number={lusha}
          isPrimary={primary === lusha || !!highlightLusha}
        />
      )}
      {!lemlist && !lusha && primary && (
        <PhoneRow label="Principal" number={primary} isPrimary />
      )}
    </div>
  );
}

function PhoneRow({
  label,
  number,
  isPrimary
}: {
  label: string;
  number: string;
  isPrimary: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="badge bg-ink-muted/15 text-ink-muted">{label}</span>
      <span className={isPrimary ? "font-semibold text-lg" : "text-ink"}>
        📞 {number}
      </span>
      {isPrimary && (
        <span className="badge bg-success-bg text-success-fg text-[10px]">
          principal en HubSpot
        </span>
      )}
    </div>
  );
}

function ContactInfo({ result }: { result: LookupResult }) {
  if (!result.contact) return null;
  return (
    <div className="text-sm">
      <div>
        <strong>{result.contact.name ?? "(sin nombre)"}</strong>{" "}
        <span className="text-ink-muted text-xs">
          (encontrado en {result.contact.source === "supabase" ? "weCAD-prospecting" : "HubSpot"})
        </span>
      </div>
      <div className="text-xs text-ink-muted mt-0.5 space-y-0.5">
        {result.contact.hubspot_contact_id && (
          <div>HubSpot ID: {result.contact.hubspot_contact_id}</div>
        )}
        {result.contact.supabase_contact_id && (
          <div>Supabase ID: {result.contact.supabase_contact_id}</div>
        )}
      </div>
    </div>
  );
}
