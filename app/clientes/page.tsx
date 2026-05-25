"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  IconPlus,
  IconBuilding,
  IconPencil,
  IconCheck,
  IconX,
  IconToggleLeft,
  IconToggleRight,
  IconLoader2,
  IconUpload,
  IconPhoto,
  IconSettings,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";

type Client = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  is_active: boolean;
  status: string;
  onboarding_step: number;
  created_at: string;
};

type FormState = {
  name: string;
  slug: string;
  logo_url: string;
};

const EMPTY_FORM: FormState = { name: "", slug: "", logo_url: "" };
const MAX_BYTES = 500 * 1024; // 500 KB

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function ClientForm({
  initial,
  onSave,
  onCancel,
  saving
}: {
  initial: FormState;
  onSave: (f: FormState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm]           = useState(initial);
  const [slugTouched, setSlugTouched] = useState(!!initial.slug);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleName(val: string) {
    setForm((f) => ({
      ...f,
      name: val,
      slug: slugTouched ? f.slug : slugify(val)
    }));
  }

  function handleSlug(val: string) {
    setSlugTouched(true);
    setForm((f) => ({ ...f, slug: slugify(val) }));
  }

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setLogoError(`El archivo pesa ${(file.size / 1024).toFixed(0)} KB — máximo 500 KB.`);
      return;
    }
    setLogoError(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      setForm((f) => ({ ...f, logo_url: (ev.target?.result as string) ?? "" }));
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label block mb-1">Nombre del cliente *</label>
        <input
          className="input"
          placeholder="Ej. Acme Corp"
          value={form.name}
          onChange={(e) => handleName(e.target.value)}
          autoFocus
        />
      </div>

      <div>
        <label className="label block mb-1">Slug (URL)</label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-muted select-none">/clientes/</span>
          <input
            className="input"
            placeholder="acme-corp"
            value={form.slug}
            onChange={(e) => handleSlug(e.target.value)}
          />
        </div>
        <p className="text-xs text-ink-subtle mt-1">Solo letras, números y guiones.</p>
      </div>

      {/* Logo por archivo */}
      <div>
        <label className="label block mb-1">Logo — opcional</label>
        <div className="flex items-center gap-3">
          {/* Preview */}
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
            style={{ background: form.logo_url ? "transparent" : "rgba(37,23,98,0.08)", border: "1px dashed #c8c3dc" }}
          >
            {form.logo_url ? (
              <img src={form.logo_url} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <IconPhoto size={20} className="text-ink-subtle" />
            )}
          </div>

          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary py-1.5 px-3 text-sm flex items-center gap-1.5"
                onClick={() => fileRef.current?.click()}
              >
                <IconUpload size={14} /> Subir PNG / JPG
              </button>
              {form.logo_url && (
                <button
                  type="button"
                  className="btn-secondary py-1.5 px-2 text-danger-fg"
                  onClick={() => { setForm((f) => ({ ...f, logo_url: "" })); setLogoError(null); }}
                  title="Quitar logo"
                >
                  <IconX size={14} />
                </button>
              )}
            </div>
            <p className="text-xs text-ink-subtle">Máximo 500 KB.</p>
            {logoError && <p className="text-xs text-danger-fg">{logoError}</p>}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={handleLogoFile}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          className="btn-primary flex-1"
          onClick={() => onSave(form)}
          disabled={saving || !form.name.trim() || !form.slug.trim()}
        >
          {saving ? <IconLoader2 size={15} className="animate-spin" /> : <IconCheck size={15} />}
          {saving ? "Guardando..." : "Guardar"}
        </button>
        <button className="btn-secondary" onClick={onCancel}>
          <IconX size={15} />
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default function ClientesPage() {
  const { setCurrentClient } = useClient();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/clients");
    const j = await r.json();
    if (j.error) { setError(j.error); setLoading(false); return; }
    setClients(j.clients ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleEdit(id: string, form: FormState) {
    setSaving(true);
    setFormError(null);
    const r = await fetch(`/api/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const j = await r.json();
    if (j.error) { setFormError(j.error); setSaving(false); return; }
    setClients((prev) =>
      prev.map((c) => (c.id === id ? j.client : c)).sort((a, b) => a.name.localeCompare(b.name))
    );
    setEditing(null);
    setSaving(false);
  }

  async function toggleActive(client: Client) {
    const r = await fetch(`/api/clients/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !client.is_active })
    });
    const j = await r.json();
    if (!j.error) {
      setClients((prev) => prev.map((c) => (c.id === client.id ? j.client : c)));
    }
  }

  const activeClients   = clients.filter((c) => c.is_active);
  const inactiveClients = clients.filter((c) => !c.is_active);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Clientes</h1>
          <p className="text-sm text-ink-muted mt-1">
            Cada cliente tiene su propio ICP, campañas y pipeline.
          </p>
        </div>
        <Link href="/clientes/nuevo" className="btn-primary inline-flex items-center gap-2">
          <IconPlus size={16} />
          Nuevo cliente
        </Link>
      </div>

      {loading && (
        <div className="card flex items-center gap-3 text-ink-muted">
          <IconLoader2 size={18} className="animate-spin" />
          Cargando clientes...
        </div>
      )}
      {error && <div className="card text-danger-fg bg-danger-bg">{error}</div>}

      {!loading && !error && (
        <>
          {activeClients.length === 0 && (
            <div className="card text-center py-10">
              <IconBuilding size={32} className="mx-auto mb-3 text-ink-subtle" />
              <p className="text-ink-muted font-medium">Sin clientes todavía</p>
              <p className="text-sm text-ink-subtle mt-1">
                Crea el primer cliente con el botón de arriba.
              </p>
            </div>
          )}

          {activeClients.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              editing={editing === client.id}
              saving={saving}
              formError={formError}
              onEdit={() => { setEditing(client.id); setFormError(null); }}
              onCancelEdit={() => { setEditing(null); setFormError(null); }}
              onSaveEdit={(form) => handleEdit(client.id, form)}
              onToggle={() => toggleActive(client)}
              onSelect={() => setCurrentClient(client)}
            />
          ))}

          {inactiveClients.length > 0 && (
            <div className="mt-8">
              <p className="label mb-3">Inactivos</p>
              {inactiveClients.map((client) => (
                <ClientCard
                  key={client.id}
                  client={client}
                  editing={editing === client.id}
                  saving={saving}
                  formError={formError}
                  onEdit={() => { setEditing(client.id); setFormError(null); }}
                  onCancelEdit={() => { setEditing(null); setFormError(null); }}
                  onSaveEdit={(form) => handleEdit(client.id, form)}
                  onToggle={() => toggleActive(client)}
                  onSelect={() => setCurrentClient(client)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ClientCard({
  client,
  editing,
  saving,
  formError,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onToggle,
  onSelect
}: {
  client: Client;
  editing: boolean;
  saving: boolean;
  formError: string | null;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (f: FormState) => void;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const isOnboarding = client.status === "onboarding" && client.onboarding_step > 0;

  return (
    <div className="card mb-3" style={{ opacity: client.is_active ? 1 : 0.55 }}>
      {editing ? (
        <>
          <h2 className="font-semibold text-ink mb-4">Editar cliente</h2>
          {formError && (
            <p className="text-danger-fg text-sm mb-3 bg-danger-bg rounded-lg px-3 py-2">{formError}</p>
          )}
          <ClientForm
            initial={{ name: client.name, slug: client.slug, logo_url: client.logo_url ?? "" }}
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
            saving={saving}
          />
        </>
      ) : (
        <div className="flex items-center gap-3">
          {client.logo_url ? (
            <img
              src={client.logo_url}
              alt={client.name}
              className="w-10 h-10 rounded-lg object-cover shrink-0"
            />
          ) : (
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-white font-bold text-sm"
              style={{ background: "#251762" }}
            >
              {client.name[0]?.toUpperCase()}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-ink truncate">{client.name}</p>
              {isOnboarding && (
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: "rgba(98,224,216,0.15)", color: "#62E0D8" }}
                >
                  Configurando... ({client.onboarding_step}/6)
                </span>
              )}
            </div>
            <p className="text-xs text-ink-subtle">/{client.slug}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isOnboarding ? (
              <Link
                href={`/clientes/${client.id}/onboarding`}
                className="btn-primary text-xs py-1.5 px-3 inline-flex items-center gap-1.5"
              >
                <IconSettings size={13} />
                Retomar wizard
              </Link>
            ) : (
              <button
                className="btn-secondary text-xs py-1.5 px-3"
                onClick={onSelect}
                title="Seleccionar como cliente activo"
              >
                Seleccionar
              </button>
            )}
            <button className="btn-secondary py-1.5 px-2" onClick={onEdit} title="Editar">
              <IconPencil size={14} />
            </button>
            <button
              className="btn-secondary py-1.5 px-2"
              onClick={onToggle}
              title={client.is_active ? "Desactivar" : "Activar"}
            >
              {client.is_active
                ? <IconToggleRight size={18} style={{ color: "#62E0D8" }} />
                : <IconToggleLeft  size={18} className="text-ink-subtle" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
