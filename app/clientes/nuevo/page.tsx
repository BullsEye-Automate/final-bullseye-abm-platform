"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconLoader2,
  IconPhoto,
  IconUpload,
  IconX,
  IconSettings,
  IconLayoutDashboard,
  IconSparkles,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";
import type { ClientSummary } from "@/lib/clientContext";

function slugify(text: string) {
  return text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export default function NuevoClientePage() {
  const router = useRouter();
  const { setCurrentClient } = useClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName]               = useState("");
  const [slug, setSlug]               = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [logoUrl, setLogoUrl]         = useState("");
  const [logoError, setLogoError]     = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Estado post-creación
  const [created, setCreated] = useState<{ id: string; summary: ClientSummary } | null>(null);

  function handleName(val: string) {
    setName(val);
    if (!slugTouched) setSlug(slugify(val));
  }

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 500 * 1024) {
      setLogoError(`El archivo pesa ${(file.size / 1024).toFixed(0)} KB — máximo 500 KB.`);
      return;
    }
    setLogoError(null);
    const reader = new FileReader();
    reader.onload = (ev) => setLogoUrl((ev.target?.result as string) ?? "");
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    if (!name.trim() || !slug.trim()) return;
    setSaving(true);
    setError(null);

    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        slug,
        logo_url: logoUrl || null,
        description: description.trim() || null,
        status: "onboarding",
        onboarding_step: 1,
      }),
    });
    const j = await res.json();
    if (j.error) { setError(j.error); setSaving(false); return; }

    const summary: ClientSummary = {
      id:       j.client.id,
      name:     j.client.name,
      slug:     j.client.slug,
      logo_url: j.client.logo_url ?? null,
    };
    setCreated({ id: j.client.id, summary });
    setSaving(false);
  }

  function goToPlatform(path = "/dashboard") {
    if (!created) return;
    setCurrentClient(created.summary);
    router.push(path);
  }

  // ── Vista post-creación ──
  if (created) {
    return (
      <div className="max-w-xl">
        <div className="card text-center py-8 px-6 space-y-6">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
            style={{ background: "rgba(98,224,216,0.15)" }}
          >
            <IconCheck size={28} style={{ color: "#62E0D8" }} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink">
              ¡Cliente creado!
            </h1>
            <p className="text-sm text-ink-muted mt-1">
              <strong>{name}</strong> está listo. ¿Qué quieres hacer ahora?
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
            {/* Opción 1: Asistente */}
            <button
              onClick={() => router.push(`/clientes/${created.id}/onboarding`)}
              className="card border-2 border-[#E5E2F0] hover:border-[#251762] p-4 text-left transition group"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                style={{ background: "rgba(37,23,98,0.08)" }}
              >
                <IconSettings size={18} style={{ color: "#251762" }} />
              </div>
              <p className="font-semibold text-ink text-sm">Asistente de configuración</p>
              <p className="text-xs text-ink-muted mt-1">
                Configura ICP, HubSpot, Clay y Lemlist paso a paso.
              </p>
            </button>

            {/* Opción 2: Ir directo */}
            <button
              onClick={() => goToPlatform("/dashboard")}
              className="card border-2 border-[#E5E2F0] hover:border-[#62E0D8] p-4 text-left transition group"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                style={{ background: "rgba(98,224,216,0.1)" }}
              >
                <IconSparkles size={18} style={{ color: "#62E0D8" }} />
              </div>
              <p className="font-semibold text-ink text-sm">Ir a la plataforma ahora</p>
              <p className="text-xs text-ink-muted mt-1">
                Empieza a trabajar de inmediato. Puedes configurar el resto después.
              </p>
            </button>
          </div>

          <p className="text-xs text-ink-muted">
            Puedes retomar el asistente en cualquier momento desde{" "}
            <Link href="/clientes" className="underline">Clientes</Link>.
          </p>
        </div>
      </div>
    );
  }

  // ── Formulario de creación ──
  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/clientes" className="btn-secondary py-1.5 px-2">
          <IconArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-ink">Nuevo cliente</h1>
          <p className="text-sm text-ink-muted mt-0.5">Solo nombre y logo — el resto es opcional</p>
        </div>
      </div>

      <div className="card space-y-5">
        {error && (
          <p className="text-danger-fg text-sm bg-danger-bg rounded-lg px-3 py-2">{error}</p>
        )}

        <div>
          <label className="label block mb-1">Nombre del cliente *</label>
          <input
            className="input"
            placeholder="Ej. Acid Labs"
            value={name}
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
              placeholder="acid-labs"
              value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }}
            />
          </div>
          <p className="text-xs text-ink-subtle mt-1">Solo letras, números y guiones.</p>
        </div>

        <div>
          <label className="label block mb-1">Logo — opcional</label>
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
              style={{ background: logoUrl ? "transparent" : "rgba(37,23,98,0.08)", border: "1px dashed #c8c3dc" }}
            >
              {logoUrl
                ? <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
                : <IconPhoto size={20} className="text-ink-subtle" />}
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <button type="button" className="btn-secondary py-1.5 px-3 text-sm flex items-center gap-1.5"
                  onClick={() => fileRef.current?.click()}>
                  <IconUpload size={14} /> Subir PNG / JPG
                </button>
                {logoUrl && (
                  <button type="button" className="btn-secondary py-1.5 px-2 text-danger-fg"
                    onClick={() => { setLogoUrl(""); setLogoError(null); }}>
                    <IconX size={14} />
                  </button>
                )}
              </div>
              <p className="text-xs text-ink-subtle">Máximo 500 KB.</p>
              {logoError && <p className="text-xs text-danger-fg">{logoError}</p>}
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleLogoFile} />
        </div>

        <div>
          <label className="label block mb-1">Descripción breve — opcional</label>
          <textarea className="input resize-none" rows={2}
            placeholder="Ej. Agencia de desarrollo de software especializada en startups..."
            value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-ink-subtle/20">
          <Link href="/clientes" className="btn-secondary flex items-center gap-2">
            <IconArrowLeft size={15} /> Cancelar
          </Link>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleSubmit}
            disabled={saving || !name.trim() || !slug.trim()}
          >
            {saving ? <IconLoader2 size={15} className="animate-spin" /> : <IconArrowRight size={15} />}
            {saving ? "Creando..." : "Crear cliente"}
          </button>
        </div>
      </div>
    </div>
  );
}
