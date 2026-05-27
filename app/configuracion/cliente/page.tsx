"use client";

import { useEffect, useState } from "react";
import {
  IconDeviceFloppy,
  IconAlertCircle,
  IconCheck,
  IconLoader2,
  IconMail,
  IconDatabase,
  IconCloud,
  IconCircleCheck,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";

type Config = {
  lemlist_campaign_id:         string;
  lemlist_staging_campaign_id: string;
  clay_companies_table_id:     string;
  clay_contacts_table_id:      string;
};

type ClientWebhooks = {
  clay_companies_webhook_url: string;
  clay_contacts_webhook_url:  string;
};

const EMPTY_CONFIG: Config = {
  lemlist_campaign_id:         "",
  lemlist_staging_campaign_id: "",
  clay_companies_table_id:     "",
  clay_contacts_table_id:      "",
};

const EMPTY_WEBHOOKS: ClientWebhooks = {
  clay_companies_webhook_url: "",
  clay_contacts_webhook_url:  "",
};

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label block mb-1">{label}</label>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ""}
      />
      <p className="text-xs text-ink-subtle mt-1">{hint}</p>
    </div>
  );
}

export default function ConfigClientePage() {
  const { currentClient } = useClient();
  const [form, setForm]         = useState<Config>(EMPTY_CONFIG);
  const [webhooks, setWebhooks] = useState<ClientWebhooks>(EMPTY_WEBHOOKS);
  const [loading, setLoading]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [savedAt, setSavedAt]       = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [hsSetup, setHsSetup]             = useState<"idle" | "running" | "done" | "error">("idle");
  const [hsSetupResult, setHsSetupResult] = useState<string | null>(null);
  const [hsLists, setHsLists]             = useState<"idle" | "running" | "done" | "error">("idle");
  const [hsListsResult, setHsListsResult] = useState<string | null>(null);
  const [sdrScripts, setSdrScripts]       = useState<"idle" | "running" | "done" | "error">("idle");
  const [sdrScriptsResult, setSdrScriptsResult] = useState<string | null>(null);

  function set(field: keyof Config) {
    return (v: string) => setForm((f) => ({ ...f, [field]: v }));
  }

  function setWebhook(field: keyof ClientWebhooks) {
    return (v: string) => setWebhooks((w) => ({ ...w, [field]: v }));
  }

  useEffect(() => {
    if (!currentClient) return;
    setLoading(true);
    setError(null);
    setSavedAt(null);

    Promise.all([
      fetch(`/api/clients/${currentClient.id}/config`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/clients/${currentClient.id}`,        { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([configData, clientData]) => {
        const cfg = configData.config;
        setForm(cfg ? {
          lemlist_campaign_id:         cfg.lemlist_campaign_id         ?? "",
          lemlist_staging_campaign_id: cfg.lemlist_staging_campaign_id ?? "",
          clay_companies_table_id:     cfg.clay_companies_table_id     ?? "",
          clay_contacts_table_id:      cfg.clay_contacts_table_id      ?? "",
        } : EMPTY_CONFIG);

        const cl = clientData.client;
        setWebhooks(cl ? {
          clay_companies_webhook_url: cl.clay_companies_webhook_url ?? "",
          clay_contacts_webhook_url:  cl.clay_contacts_webhook_url  ?? "",
        } : EMPTY_WEBHOOKS);

        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [currentClient?.id]);

  async function generateSdrScripts() {
    if (!currentClient) return;
    setSdrScripts("running");
    setSdrScriptsResult(null);
    try {
      const res = await fetch("/api/contacts/generate-scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: currentClient.id }),
      });
      const d = await res.json();
      if (!res.ok) { setSdrScripts("error"); setSdrScriptsResult(d.error ?? "Error"); return; }
      const firstErr = d.errors?.[0]?.error ?? "";
      setSdrScriptsResult(
        `${d.generated} scripts generados` +
        (d.errors?.length ? ` — ${d.errors.length} errores: ${firstErr.slice(0, 120)}` : "")
      );
      setSdrScripts(d.errors?.length > 0 ? "error" : "done");
    } catch (e: any) {
      setSdrScripts("error");
      setSdrScriptsResult(e.message ?? "Error de red");
    }
  }

  async function setupHubSpotLists() {
    if (!currentClient) return;
    setHsLists("running");
    setHsListsResult(null);
    try {
      const res = await fetch("/api/hubspot/setup-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: currentClient.id }),
      });
      const d = await res.json();
      if (!res.ok) { setHsLists("error"); setHsListsResult(d.error ?? "Error"); return; }
      const folder = d.folder.created ? "Carpeta creada" : "Sin carpeta";
      const errMsg = d.lists.errorMessages?.join(" | ") ?? "";
      setHsListsResult(`${folder} · ${d.lists.created} listas creadas${d.lists.errors ? ` — ${errMsg}` : ""}`);
      setHsLists(d.lists.errors > 0 ? "error" : "done");
    } catch (e: any) {
      setHsLists("error");
      setHsListsResult(e.message ?? "Error de red");
    }
  }

  async function setupHubSpotProperties() {
    setHsSetup("running");
    setHsSetupResult(null);
    try {
      const res = await fetch("/api/hubspot/setup-properties", { method: "POST" });
      const d   = await res.json();
      if (!res.ok) { setHsSetup("error"); setHsSetupResult(d.error ?? "Error"); return; }
      const { summary } = d;
      setHsSetupResult(
        `Contactos: ${summary.contacts.created} creadas, ${summary.contacts.exists} ya existían` +
        ` · Empresas: ${summary.companies.created} creadas, ${summary.companies.exists} ya existían`
      );
      setHsSetup("done");
    } catch (e: any) {
      setHsSetup("error");
      setHsSetupResult(e.message ?? "Error de red");
    }
  }

  async function save() {
    if (!currentClient) return;
    setSaving(true);
    setError(null);

    const [configRes, clientRes] = await Promise.all([
      fetch(`/api/clients/${currentClient.id}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      }),
      fetch(`/api/clients/${currentClient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clay_companies_webhook_url: webhooks.clay_companies_webhook_url || null,
          clay_contacts_webhook_url:  webhooks.clay_contacts_webhook_url  || null,
        }),
      }),
    ]);

    setSaving(false);

    if (!configRes.ok) {
      const d = await configRes.json().catch(() => ({}));
      setError(d.error ?? "Error al guardar la configuración");
      return;
    }
    if (!clientRes.ok) {
      const d = await clientRes.json().catch(() => ({}));
      setError(d.error ?? "Error al guardar las URLs de webhook");
      return;
    }
    setSavedAt(new Date().toLocaleTimeString());
  }

  if (!currentClient) {
    return (
      <div className="card flex items-center gap-3 text-warning-fg border border-warning-bg bg-warning-bg/40 text-sm max-w-xl">
        <IconAlertCircle size={18} className="shrink-0" />
        Selecciona un cliente en el sidebar para ver su configuración de integraciones.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <header className="flex items-end justify-between">
        <div>
          <div className="label">Sistema · Configuración</div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Integraciones
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <div
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
              style={{ background: "#251762" }}
            >
              {currentClient.name}
            </div>
            <span className="text-sm text-ink-muted">
              IDs de Lemlist y Clay para este cliente.
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="text-xs text-success-fg flex items-center gap-1">
              <IconCheck size={14} /> Guardado {savedAt}
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || loading || !currentClient}
            className="btn-primary"
          >
            {saving
              ? <IconLoader2 size={16} className="animate-spin" />
              : <IconDeviceFloppy size={16} />}
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </header>

      {error && (
        <div className="card border border-danger-bg text-danger-fg flex items-center gap-2 text-sm">
          <IconAlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div className="card flex items-center gap-3 text-ink-muted">
          <IconLoader2 size={18} className="animate-spin" /> Cargando configuración…
        </div>
      ) : (
        <>
          {/* Lemlist */}
          <section className="card space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <IconMail size={18} className="text-brand" /> Lemlist
            </h2>
            <Field
              label="Campaign ID principal"
              hint="ID de la campaña de outreach activa (email + LinkedIn). Se encuentra en la URL de la campaña en Lemlist."
              placeholder="cam_xxxxxxxxxxxxxxxxxx"
              value={form.lemlist_campaign_id}
              onChange={set("lemlist_campaign_id")}
            />
            <Field
              label="Campaign ID puente (staging)"
              hint="Campaña sin pasos usada para importar leads desde Sales Navigator. El SDR la usa con la extensión de Lemlist."
              placeholder="cam_xxxxxxxxxxxxxxxxxx"
              value={form.lemlist_staging_campaign_id}
              onChange={set("lemlist_staging_campaign_id")}
            />
          </section>

          {/* HubSpot */}
          <section className="card space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <IconCloud size={18} className="text-brand" /> HubSpot
            </h2>
            <p className="text-sm text-ink-muted">
              Crea las propiedades custom de BullsEye en HubSpot (email body, icebreaker, teléfono Lusha, fit score, etc.).
              Ejecuta esto <strong>una sola vez</strong> — si las propiedades ya existen las saltará sin error.
            </p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={setupHubSpotProperties}
                  disabled={hsSetup === "running"}
                  className="btn-secondary flex items-center gap-2 text-sm"
                >
                  {hsSetup === "running"
                    ? <IconLoader2 size={15} className="animate-spin" />
                    : hsSetup === "done"
                    ? <IconCircleCheck size={15} className="text-success-fg" />
                    : <IconCloud size={15} />}
                  {hsSetup === "running" ? "Creando propiedades…" : "Crear propiedades en HubSpot"}
                </button>
                {hsSetupResult && (
                  <span className={`text-xs ${hsSetup === "error" ? "text-danger-fg" : "text-success-fg"}`}>
                    {hsSetupResult}
                  </span>
                )}
              </div>

              <div>
                <p className="text-sm text-ink-muted mb-2">
                  Crea la carpeta <strong>{currentClient.name}</strong> y las 3 listas de segmentación en HubSpot
                  (Alta interacción, Warm por llamar, Hot por llamar). Requiere que las propiedades ya estén creadas.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={setupHubSpotLists}
                    disabled={hsLists === "running"}
                    className="btn-secondary flex items-center gap-2 text-sm"
                  >
                    {hsLists === "running"
                      ? <IconLoader2 size={15} className="animate-spin" />
                      : hsLists === "done"
                      ? <IconCircleCheck size={15} className="text-success-fg" />
                      : <IconCloud size={15} />}
                    {hsLists === "running" ? "Creando listas…" : "Crear listas en HubSpot"}
                  </button>
                  {hsListsResult && (
                    <span className={`text-xs ${hsLists === "error" ? "text-danger-fg" : "text-success-fg"}`}>
                      {hsListsResult}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* SDR Script IA */}
          <section className="card space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <IconCloud size={18} className="text-brand" /> Script SDR IA
            </h2>
            <p className="text-sm text-ink-muted">
              Genera scripts de llamada personalizados para cada contacto usando Claude.
              El script incluye apertura, propuesta de valor, preguntas de calificación, manejo de objeciones y CTA.
              Se guarda en HubSpot como <code className="text-xs bg-surface-2 px-1 rounded">bullseye_script_sdr_ia</code> y en Supabase.
              Solo procesa contactos que aún no tienen script.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={generateSdrScripts}
                disabled={sdrScripts === "running"}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                {sdrScripts === "running"
                  ? <IconLoader2 size={15} className="animate-spin" />
                  : sdrScripts === "done"
                  ? <IconCircleCheck size={15} className="text-success-fg" />
                  : <IconCloud size={15} />}
                {sdrScripts === "running" ? "Generando scripts…" : "Generar scripts SDR"}
              </button>
              {sdrScriptsResult && (
                <span className={`text-xs ${sdrScripts === "error" ? "text-danger-fg" : "text-success-fg"}`}>
                  {sdrScriptsResult}
                </span>
              )}
            </div>
          </section>

          {/* Clay */}
          <section className="card space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <IconDatabase size={18} className="text-brand" /> Clay
            </h2>
            <Field
              label="Companies Webhook URL"
              hint="URL del Webhook Source de la tabla Companies en Clay. Clay → tabla Companies → columna Webhook → panel derecho → URL. La app la usa para enviar empresas aprobadas a Clay."
              placeholder="https://api.clay.com/v3/sources/webhook/..."
              value={webhooks.clay_companies_webhook_url}
              onChange={setWebhook("clay_companies_webhook_url")}
            />
            <Field
              label="Contacts Webhook URL"
              hint="URL del Webhook Source de la tabla Contacts en Clay. Clay → tabla Contacts → columna Webhook → panel derecho → URL. La app la usa para enviar contactos pre-filter YES a Clay."
              placeholder="https://api.clay.com/v3/sources/webhook/..."
              value={webhooks.clay_contacts_webhook_url}
              onChange={setWebhook("clay_contacts_webhook_url")}
            />
            <Field
              label="Companies table ID"
              hint="ID de la tabla de empresas en Clay. Se usa para configurar el webhook de entrada y el botón 'Prospectar en Clay'."
              placeholder="tbl_xxxxxxxxxxxxxxxxxx"
              value={form.clay_companies_table_id}
              onChange={set("clay_companies_table_id")}
            />
            <Field
              label="Contacts table ID"
              hint="ID de la tabla de contactos en Clay. Recibe los contactos pre-filter YES para scoring y enriquecimiento."
              placeholder="tbl_xxxxxxxxxxxxxxxxxx"
              value={form.clay_contacts_table_id}
              onChange={set("clay_contacts_table_id")}
            />
          </section>
        </>
      )}
    </div>
  );
}
