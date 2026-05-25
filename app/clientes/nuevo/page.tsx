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
} from "@tabler/icons-react";

const STEP_LABELS = ["Datos básicos", "ICP", "HubSpot", "Clay", "Lemlist", "Activación"];

function WizardStepper({ current }: { current: number }) {
  return (
    <div className="flex items-center mb-8 overflow-x-auto pb-1">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <div key={n} className="flex items-center">
            <div className="flex flex-col items-center min-w-0">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                style={{
                  background: done ? "#62E0D8" : active ? "transparent" : "rgba(37,23,98,0.08)",
                  border: active ? "2px solid #251762" : done ? "none" : "2px solid #d1d5db",
                  color: done ? "#251762" : active ? "#251762" : "#9ca3af",
                }}
              >
                {done ? <IconCheck size={14} /> : n}
              </div>
              <span className="text-xs mt-1 text-center whitespace-nowrap"
                style={{ color: active ? "#251762" : done ? "#6b7280" : "#9ca3af", fontWeight: active ? 600 : 400 }}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className="h-0.5 mx-2 shrink-0"
                style={{ width: 32, background: done ? "#62E0D8" : "#e5e7eb", marginBottom: 20 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function slugify(text: string) {
  return text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export default function NuevoClientePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  const [logoError, setLogoError] = useState<string | null>(null);
  const [description, setDescription] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    router.push(`/clientes/${j.client.id}/onboarding`);
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/clientes" className="btn-secondary py-1.5 px-2">
          <IconArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-ink">Nuevo cliente</h1>
          <p className="text-sm text-ink-muted mt-0.5">Wizard de onboarding — 6 pasos</p>
        </div>
      </div>

      <WizardStepper current={1} />

      <div className="card">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
            style={{ background: "#251762" }}>1</div>
          <h2 className="text-lg font-semibold text-ink">Datos básicos</h2>
        </div>

        {error && (
          <p className="text-danger-fg text-sm mb-4 bg-danger-bg rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="space-y-5">
          <div>
            <label className="label block mb-1">Nombre del cliente *</label>
            <input className="input" placeholder="Ej. Clínica Dental Norte"
              value={name} onChange={(e) => handleName(e.target.value)} autoFocus />
          </div>

          <div>
            <label className="label block mb-1">Slug (URL)</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-muted select-none">/clientes/</span>
              <input className="input" placeholder="clinica-dental-norte"
                value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} />
            </div>
            <p className="text-xs text-ink-subtle mt-1">Solo letras, números y guiones.</p>
          </div>

          <div>
            <label className="label block mb-1">Logo — opcional</label>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
                style={{ background: logoUrl ? "transparent" : "rgba(37,23,98,0.08)", border: "1px dashed #c8c3dc" }}>
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
            <input ref={fileRef} type="file" accept="image/png,image/jpeg"
              className="hidden" onChange={handleLogoFile} />
          </div>

          <div>
            <label className="label block mb-1">Descripción breve del negocio</label>
            <textarea className="input resize-none" rows={3}
              placeholder="Ej. Red de clínicas dentales en LATAM enfocadas en ortodoncia y estética dental..."
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-ink-subtle/20">
          <Link href="/clientes" className="btn-secondary flex items-center gap-2">
            <IconArrowLeft size={15} /> Cancelar
          </Link>
          <button className="btn-primary flex items-center gap-2"
            onClick={handleSubmit} disabled={saving || !name.trim() || !slug.trim()}>
            {saving ? <IconLoader2 size={15} className="animate-spin" /> : <IconArrowRight size={15} />}
            {saving ? "Guardando..." : "Siguiente — Paso 2"}
          </button>
        </div>
      </div>
    </div>
  );
}
