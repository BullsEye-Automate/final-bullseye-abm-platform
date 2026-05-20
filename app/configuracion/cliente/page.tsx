"use client";

import { useEffect, useState } from "react";
import {
  IconDeviceFloppy,
  IconAlertCircle,
  IconCheck,
  IconLoader2,
  IconMail,
  IconBrandLinkedin,
  IconDatabase,
  IconFunnel
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";

type Config = {
  lemlist_campaign_id:         string;
  lemlist_staging_campaign_id: string;
  clay_companies_table_id:     string;
  clay_contacts_table_id:      string;
  hubspot_pipeline_id:         string;
  hubspot_owner_id:            string;
};

const EMPTY: Config = {
  lemlist_campaign_id:         "",
  lemlist_staging_campaign_id: "",
  clay_companies_table_id:     "",
  clay_contacts_table_id:      "",
  hubspot_pipeline_id:         "",
  hubspot_owner_id:            ""
};

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder
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
  const [form, setForm]     = useState<Config>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  function set(field: keyof Config) {
    return (v: string) => setForm((f) => ({ ...f, [field]: v }));
  }

  useEffect(() => {
    if (!currentClient) return;
    setLoading(true);
    setError(null);
    setSavedAt(null);
    fetch(`/api/clients/${currentClient.id}/config`, { cache: "no-store" })
      .then((r) => r.json())
      .then(({ config }) => {
        setForm(config ? {
          lemlist_campaign_id:         config.lemlist_campaign_id         ?? "",
          lemlist_staging_campaign_id: config.lemlist_staging_campaign_id ?? "",
          clay_companies_table_id:     config.clay_companies_table_id     ?? "",
          clay_contacts_table_id:      config.clay_contacts_table_id      ?? "",
          hubspot_pipeline_id:         config.hubspot_pipeline_id         ?? "",
          hubspot_owner_id:            config.hubspot_owner_id            ?? ""
        } : EMPTY);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [currentClient?.id]);

  async function save() {
    if (!currentClient) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/clients/${currentClient.id}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? "Error al guardar"); return; }
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
              IDs de Lemlist, Clay y HubSpot para este cliente.
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

          {/* Clay */}
          <section className="card space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <IconDatabase size={18} className="text-brand" /> Clay
            </h2>
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

          {/* HubSpot */}
          <section className="card space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <IconFunnel size={18} className="text-brand" /> HubSpot
            </h2>
            <Field
              label="Pipeline ID"
              hint="ID del pipeline de HubSpot donde se crean los deals de este cliente. En HubSpot: Configuración → Pipelines."
              placeholder="xxxxxxxx"
              value={form.hubspot_pipeline_id}
              onChange={set("hubspot_pipeline_id")}
            />
            <Field
              label="Owner ID (SDR asignado)"
              hint="User ID del SDR en HubSpot que se asigna como propietario de los contactos y deals de este cliente."
              placeholder="xxxxxxxx"
              value={form.hubspot_owner_id}
              onChange={set("hubspot_owner_id")}
            />
          </section>
        </>
      )}
    </div>
  );
}
