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
  IconTool,
  IconUpload,
  IconTrash,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";

type Config = {
  lemlist_api_key:             string;
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
  lemlist_api_key:             "",
  lemlist_campaign_id:         "",
  lemlist_staging_campaign_id: "",
  clay_companies_table_id:     "",
  clay_contacts_table_id:      "",
};

const EMPTY_WEBHOOKS: ClientWebhooks = {
  clay_companies_webhook_url: "",
  clay_contacts_webhook_url:  "",
};

type ExcludedCompany = { id: string; company_name: string; company_website?: string };

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

  const [excluded, setExcluded]             = useState<ExcludedCompany[]>([]);
  const [excludedLoading, setExcludedLoading] = useState(false);
  const [uploadState, setUploadState]         = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [uploadResult, setUploadResult]       = useState<string | null>(null);

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
          lemlist_api_key:             cfg.lemlist_api_key             ?? "",
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

    // Cargar empresas excluidas
    setExcludedLoading(true);
    fetch(`/api/clients/${currentClient.id}/excluded-companies`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setExcluded(d.excluded ?? []))
      .catch(() => {})
      .finally(() => setExcludedLoading(false));
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

  async function uploadExcluded(file: File) {
    if (!currentClient) return;
    setUploadState("uploading");
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/clients/${currentClient.id}/excluded-companies`, {
        method: "POST",
        body: fd,
      });
      const d = await res.json();
      if (!res.ok) { setUploadState("error"); setUploadResult(d.error ?? "Error"); return; }
      setUploadResult(`${d.inserted} empresas agregadas (${d.total} en el archivo)`);
      setUploadState("done");
      // Recargar lista
      fetch(`/api/clients/${currentClient.id}/excluded-companies`, { cache: "no-store" })
        .then((r) => r.json()).then((d) => setExcluded(d.excluded ?? [])).catch(() => {});
    } catch (e: any) {
      setUploadState("error");
      setUploadResult(e.message ?? "Error de red");
    }
  }

  async function deleteExcluded(id: string) {
    if (!currentClient) return;
    const res = await fetch(`/api/clients/${currentClient.id}/excluded-companies`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    if (res.ok) setExcluded((prev) => prev.filter((e) => e.id !== id));
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
              label="API Key de Lemlist"
              hint="API key de la cuenta de Lemlist de este cliente. Si se deja vacío, se usa la cuenta principal de BullsEye. Encuéntrala en Lemlist → Settings → Integrations → API."
              placeholder="••••••••••••••••••"
              value={form.lemlist_api_key}
              onChange={set("lemlist_api_key")}
            />
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

          {/* Empresas excluidas */}
          <section className="card space-y-4">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <IconTrash size={18} className="text-brand" /> Empresas excluidas
              </h2>
              <p className="text-sm text-ink-muted mt-1">
                La IA no sugerirá estas empresas al usar el motor de recomendación.
                Útil para clientes actuales, competidores o empresas que ya estás trabajando.
              </p>
            </div>

            {/* Upload Excel */}
            <div className="space-y-2">
              <p className="text-xs text-ink-muted">
                Sube un Excel con una columna llamada <code className="bg-surface-2 px-1 rounded">Company</code>, <code className="bg-surface-2 px-1 rounded">Name</code> o <code className="bg-surface-2 px-1 rounded">Empresa</code>.
              </p>
              <div className="flex items-center gap-3">
                <label className="btn-secondary flex items-center gap-2 text-sm cursor-pointer">
                  {uploadState === "uploading"
                    ? <IconLoader2 size={15} className="animate-spin" />
                    : uploadState === "done"
                    ? <IconCircleCheck size={15} className="text-success-fg" />
                    : <IconUpload size={15} />}
                  {uploadState === "uploading" ? "Subiendo…" : "Subir Excel"}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) { uploadExcluded(f); e.target.value = ""; }
                    }}
                  />
                </label>
                {uploadResult && (
                  <span className={`text-xs ${uploadState === "error" ? "text-danger-fg" : "text-success-fg"}`}>
                    {uploadResult}
                  </span>
                )}
              </div>
            </div>

            {/* Lista actual */}
            {excludedLoading ? (
              <div className="flex items-center gap-2 text-ink-muted text-sm">
                <IconLoader2 size={14} className="animate-spin" /> Cargando…
              </div>
            ) : excluded.length === 0 ? (
              <p className="text-xs text-ink-muted">No hay empresas excluidas para este cliente.</p>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {excluded.map((e) => (
                  <div key={e.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-surface-2 group">
                    <span className="text-sm">{e.company_name}</span>
                    <button
                      onClick={() => deleteExcluded(e.id)}
                      className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-danger-fg transition-opacity"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                ))}
                <p className="text-xs text-ink-muted pt-1">{excluded.length} empresa{excluded.length !== 1 ? "s" : ""} excluida{excluded.length !== 1 ? "s" : ""}</p>
              </div>
            )}
          </section>

          {/* Setup retroactivo */}
          <section className="card space-y-5">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <IconTool size={18} className="text-brand" /> Setup retroactivo
              </h2>
              <p className="text-sm text-ink-muted mt-1">
                Acciones de configuración puntual o para aplicar cambios a contactos ya existentes.
                Los nuevos contactos se procesan automáticamente al hacer push a Lemlist.
              </p>
            </div>

            {/* HubSpot propiedades */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Propiedades HubSpot</p>
              <p className="text-xs text-ink-muted">
                Crea las propiedades custom <code className="bg-surface-2 px-1 rounded">bullseye_*</code> en HubSpot
                (email body, icebreaker, teléfono Lusha, fit score, engagement score, etc.).
                Ejecuta esto <strong>una sola vez</strong> globalmente — si ya existen las saltará.
              </p>
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
            </div>

            <div className="border-t border-border" />

            {/* HubSpot listas */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Listas HubSpot — {currentClient.name}</p>
              <p className="text-xs text-ink-muted">
                Crea la carpeta <strong>{currentClient.name}</strong> y las 3 listas de segmentación
                (Alta interacción, Warm por llamar, Hot por llamar). Para clientes nuevos esto ocurre automáticamente.
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

            <div className="border-t border-border" />

            {/* Script SDR IA */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Script SDR IA</p>
              <p className="text-xs text-ink-muted">
                Genera scripts de llamada personalizados para contactos existentes que aún no tienen script.
                Para contactos nuevos el script se genera automáticamente al hacer push a Lemlist.
                Se guarda en HubSpot como <code className="bg-surface-2 px-1 rounded">bullseye_script_sdr_ia</code>.
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
                    : <IconTool size={15} />}
                  {sdrScripts === "running" ? "Generando scripts…" : "Generar scripts SDR"}
                </button>
                {sdrScriptsResult && (
                  <span className={`text-xs ${sdrScripts === "error" ? "text-danger-fg" : "text-success-fg"}`}>
                    {sdrScriptsResult}
                  </span>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
