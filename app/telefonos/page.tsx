"use client";

import { useState } from "react";
import {
  IconPhone,
  IconAlertCircle,
  IconCheck,
  IconExternalLink,
  IconSearch
} from "@tabler/icons-react";

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
  const [result, setResult] = useState<LookupResult | null>(null);

  async function run() {
    if (!url.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/lusha-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_url: url.trim() })
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
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !loading) run();
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
          de HubSpot. Si el contacto está también en weCAD-prospecting, se
          sincroniza acá también.
        </div>
      </header>

      <div className="card p-4 space-y-3">
        <label className="text-sm font-medium">LinkedIn URL</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={onKey}
            placeholder="https://www.linkedin.com/in/usuario/"
            disabled={loading}
            className="input flex-1"
          />
          <button onClick={run} disabled={loading || !url.trim()} className="btn-primary">
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

      {result && <ResultPanel result={result} />}
    </div>
  );
}

function ResultPanel({ result }: { result: LookupResult }) {
  if (result.status === "not_found") {
    return (
      <div className="card p-4 border-l-4 border-danger-fg">
        <div className="flex items-center gap-2 font-medium text-danger-fg">
          <IconAlertCircle size={16} /> Contacto no encontrado
        </div>
        <div className="text-sm text-ink-muted mt-1">
          {result.error ??
            "No encontré ese LinkedIn en Supabase ni en HubSpot. Verificá que el contacto haya pasado por la app o que el LinkedIn URL del contact en HubSpot sea exactamente este."}
        </div>
        <div className="text-xs text-ink-muted mt-2">
          URL probada: <code>{result.linkedin_url}</code>
        </div>
      </div>
    );
  }

  if (result.status === "already_has_phone") {
    return (
      <div className="card p-4 border-l-4 border-success-fg">
        <div className="flex items-center gap-2 font-medium text-success-fg">
          <IconCheck size={16} /> Ya tenía teléfono — no se llamó a Lusha
        </div>
        <ContactInfo result={result} />
        <div className="text-sm mt-2">
          📞 <strong>{result.phone}</strong>
        </div>
        <div className="text-xs text-ink-muted mt-1">
          Si el teléfono parece incorrecto, podés actualizarlo manualmente en
          HubSpot o decirle al admin que lo borre para volver a llamar a Lusha.
        </div>
      </div>
    );
  }

  if (result.status === "phone_not_found") {
    return (
      <div className="card p-4 border-l-4 border-warning-fg">
        <div className="flex items-center gap-2 font-medium text-warning-fg">
          <IconAlertCircle size={16} /> Lusha no encontró teléfono
        </div>
        <ContactInfo result={result} />
        <div className="text-sm text-ink-muted mt-2">
          Lusha respondió OK pero no devolvió phone para este contacto. No se
          cobró crédito (Lusha solo cobra cuando devuelve resultado).
        </div>
        {result.lusha_debug !== undefined && (
          <pre className="text-[10px] bg-ink-muted/10 p-2 rounded mt-2 overflow-auto">
            {JSON.stringify(result.lusha_debug, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  // enriched
  return (
    <div className="card p-4 border-l-4 border-success-fg">
      <div className="flex items-center gap-2 font-medium text-success-fg">
        <IconCheck size={16} /> Teléfono encontrado y guardado
      </div>
      <ContactInfo result={result} />
      <div className="text-lg font-semibold mt-3">📞 {result.phone}</div>
      <div className="text-xs text-ink-muted mt-2 space-y-0.5">
        {result.hubspot_updated && <div>✓ Actualizado en HubSpot</div>}
        {result.supabase_updated && <div>✓ Actualizado en weCAD-prospecting (Supabase)</div>}
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
        <div className="mt-2">
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

function ContactInfo({ result }: { result: LookupResult }) {
  if (!result.contact) return null;
  return (
    <div className="text-sm mt-2">
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
