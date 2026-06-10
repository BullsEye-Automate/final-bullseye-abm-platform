"use client";

import { useState } from "react";
import {
  IconPhone,
  IconCopy,
  IconCheck,
  IconAlertCircle,
  IconLoader2,
  IconInfoCircle,
  IconBrandLinkedin,
  IconMail,
  IconUser,
  IconBuilding,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";

// ── Tipos ──────────────────────────────────────────────────────

type ProviderResult = {
  status: "idle" | "running" | "found" | "not_found" | "error";
  phone: string | null;
  detail: string | null;
};

const IDLE: ProviderResult = { status: "idle", phone: null, detail: null };

// ── Helpers ────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors"
      style={{
        background: copied ? "rgba(98,224,216,0.15)" : "rgba(255,255,255,0.08)",
        color: copied ? "#62E0D8" : "#e2e8f0",
        border: `1px solid ${copied ? "#62E0D8" : "rgba(255,255,255,0.15)"}`,
      }}
    >
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

function ProviderCard({
  name,
  logo,
  result,
  requires,
}: {
  name: string;
  logo: React.ReactNode;
  result: ProviderResult;
  requires: string;
}) {
  const colors = {
    idle:      { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  text: "#94a3b8" },
    running:   { bg: "rgba(98,224,216,0.06)",  border: "rgba(98,224,216,0.3)",   text: "#62E0D8" },
    found:     { bg: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.35)",   text: "#4ade80" },
    not_found: { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.12)", text: "#64748b" },
    error:     { bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.3)",    text: "#f87171" },
  };
  const c = colors[result.status];

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 transition-all"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {logo}
          <span className="font-semibold text-sm" style={{ color: c.text }}>{name}</span>
        </div>
        {result.status === "running" && <IconLoader2 size={16} className="animate-spin" style={{ color: c.text }} />}
        {result.status === "found"   && <IconCheck size={16} style={{ color: c.text }} />}
      </div>

      <p className="text-xs text-ink-subtle">{requires}</p>

      {result.status === "idle" && (
        <p className="text-xs text-ink-subtle italic">Esperando…</p>
      )}
      {result.status === "running" && (
        <p className="text-xs" style={{ color: c.text }}>{result.detail ?? "Buscando…"}</p>
      )}
      {result.status === "found" && result.phone && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-base font-semibold" style={{ color: c.text }}>{result.phone}</span>
          <CopyButton text={result.phone} />
        </div>
      )}
      {result.status === "not_found" && (
        <p className="text-xs" style={{ color: c.text }}>{result.detail ?? "No encontró teléfono"}</p>
      )}
      {result.status === "error" && (
        <p className="text-xs" style={{ color: c.text }}>{result.detail ?? "Error"}</p>
      )}
    </div>
  );
}

// ── Página ─────────────────────────────────────────────────────

export default function TelefonosPage() {
  const { currentClient } = useClient();

  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [email,       setEmail]       = useState("");
  const [firstName,   setFirstName]   = useState("");
  const [lastName,    setLastName]    = useState("");
  const [company,     setCompany]     = useState("");

  const [running, setRunning] = useState(false);
  const [done,    setDone]    = useState(false);

  const [clay,    setClay]    = useState<ProviderResult>(IDLE);
  const [lemlist, setLemlist] = useState<ProviderResult>(IDLE);
  const [lusha,   setLusha]   = useState<ProviderResult>(IDLE);

  const canLusha = email.trim() || (firstName.trim() && lastName.trim() && company.trim());

  async function runCascade(e: React.FormEvent) {
    e.preventDefault();
    if (!linkedinUrl.trim()) return;
    if (!currentClient?.id) return;

    const url = normalizeLinkedInUrl(linkedinUrl.trim()) ?? linkedinUrl.trim();

    setRunning(true);
    setDone(false);
    setClay(IDLE);
    setLemlist(IDLE);
    setLusha(IDLE);

    // ── Paso 1: Clay ──────────────────────────────────────────
    setClay({ status: "running", phone: null, detail: "Enviando a Clay (waterfall LeadMagic → PDL → upcell → Clay → Wiza)…" });
    let clayPhone: string | null = null;
    try {
      const since = new Date().toISOString();
      const r = await fetch("/api/clay/push-contact-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_hoc: true, linkedin_url: url, client_id: currentClient.id }),
      });
      const d = await r.json();
      if (!r.ok) {
        setClay({ status: "error", phone: null, detail: d.error ?? "Error enviando a Clay" });
      } else {
        setClay({ status: "running", phone: null, detail: "Clay corriendo waterfall (1-3 min)…" });
        // Poll hasta 3 min
        const deadline = Date.now() + 3 * 60 * 1000;
        clayPhone = await new Promise<string | null>((resolve) => {
          const poll = async () => {
            if (Date.now() > deadline) { resolve(null); return; }
            try {
              const pr = await fetch(`/api/phone-lookups?linkedin_url=${encodeURIComponent(url)}&source=clay&since=${encodeURIComponent(since)}`);
              const pd = await pr.json();
              if (pd.lookup) { resolve(pd.lookup.phone ?? null); return; }
            } catch {}
            setTimeout(poll, 5000);
          };
          setTimeout(poll, 5000);
        });

        if (clayPhone) {
          setClay({ status: "found", phone: clayPhone, detail: null });
        } else {
          setClay({ status: "not_found", phone: null, detail: "Clay no encontró teléfono en 3 min — puede llegar tarde a HubSpot automáticamente." });
        }
      }
    } catch {
      setClay({ status: "error", phone: null, detail: "Error de conexión con Clay" });
    }

    // ── Paso 2: Lemlist ───────────────────────────────────────
    setLemlist({ status: "running", phone: null, detail: "Buscando con Lemlist (findPhone)…" });
    let lemlistPhone: string | null = null;
    try {
      const r = await fetch("/api/lemlist/lookup-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: currentClient.id, linkedin_url: url }),
      });
      const d = await r.json();
      if (!r.ok) {
        setLemlist({ status: "error", phone: null, detail: d.error ?? "Error en Lemlist" });
      } else if (d.found && d.phone) {
        lemlistPhone = d.phone;
        setLemlist({ status: "found", phone: d.phone, detail: null });
      } else {
        setLemlist({ status: "not_found", phone: null, detail: d.message ?? "Lemlist no encontró teléfono" });
      }
    } catch {
      setLemlist({ status: "error", phone: null, detail: "Error de conexión con Lemlist" });
    }

    // ── Paso 3: Lusha ─────────────────────────────────────────
    if (canLusha) {
      setLusha({ status: "running", phone: null, detail: "Consultando Lusha…" });
      try {
        const r = await fetch("/api/lusha/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            linkedin_url: url,
            email:        email.trim()     || undefined,
            first_name:   firstName.trim() || undefined,
            last_name:    lastName.trim()  || undefined,
            company_name: company.trim()   || undefined,
          }),
        });
        const d = await r.json();
        if (!r.ok) {
          setLusha({ status: "error", phone: null, detail: d.error ?? "Error en Lusha" });
        } else if (d.found && d.phone) {
          setLusha({ status: "found", phone: d.phone, detail: null });
        } else {
          setLusha({ status: "not_found", phone: null, detail: d.message ?? "Lusha no encontró teléfono" });
        }
      } catch {
        setLusha({ status: "error", phone: null, detail: "Error de conexión con Lusha" });
      }
    } else {
      setLusha({ status: "not_found", phone: null, detail: "Sin datos suficientes — proporciona email o nombre+empresa para activar Lusha." });
    }

    setRunning(false);
    setDone(true);
  }

  const found = [clay, lemlist, lusha].filter((r) => r.status === "found");

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <header>
        <div className="label">SDR · Enriquecimiento de Teléfonos</div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Buscar teléfono</h1>
        <p className="text-sm text-ink-muted mt-1">
          Cascada automática: Clay (waterfall completo) → Lemlist (findPhone) → Lusha.
          Todos los resultados quedan en pantalla listos para copiar.
        </p>
      </header>

      {/* Instrucciones */}
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ background: "rgba(98,224,216,0.06)", border: "1px solid rgba(98,224,216,0.2)" }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#62E0D8" }}>
          <IconInfoCircle size={16} /> Cómo funciona
        </div>
        <ol className="text-sm text-ink-muted space-y-1.5 list-decimal list-inside">
          <li>Pega el LinkedIn URL del contacto (obligatorio para los 3 proveedores).</li>
          <li><strong>Clay</strong> corre un waterfall de 5 proveedores — tarda 1-3 min. Solo necesita LinkedIn URL.</li>
          <li><strong>Lemlist</strong> usa findPhone sobre la campaña staging — tarda 10-30s. Solo necesita LinkedIn URL.</li>
          <li><strong>Lusha</strong> necesita además <em>email</em> ó <em>nombre + apellido + empresa</em>.</li>
          <li>Los números encontrados aparecen con botón de copiar para pegarlo en HubSpot.</li>
        </ol>
      </div>

      {/* Formulario */}
      <form onSubmit={runCascade} className="card space-y-4">
        {/* LinkedIn URL */}
        <div>
          <label className="label flex items-center gap-1.5 mb-1">
            <IconBrandLinkedin size={14} />
            LinkedIn URL <span className="text-danger-fg">*</span>
          </label>
          <input
            className="input"
            placeholder="https://linkedin.com/in/nombre-apellido"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            disabled={running}
            required
          />
        </div>

        {/* Separador Lusha */}
        <div>
          <p className="text-xs font-semibold text-ink-subtle uppercase tracking-wide mb-3">
            Datos opcionales para Lusha
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label flex items-center gap-1 mb-1">
                <IconMail size={13} /> Email
              </label>
              <input
                className="input text-sm"
                placeholder="correo@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={running}
              />
            </div>
            <div>
              <label className="label flex items-center gap-1 mb-1">
                <IconUser size={13} /> Nombre
              </label>
              <input
                className="input text-sm"
                placeholder="Juan"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={running}
              />
            </div>
            <div>
              <label className="label flex items-center gap-1 mb-1">
                <IconUser size={13} /> Apellido
              </label>
              <input
                className="input text-sm"
                placeholder="Pérez"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={running}
              />
            </div>
            <div>
              <label className="label flex items-center gap-1 mb-1">
                <IconBuilding size={13} /> Empresa
              </label>
              <input
                className="input text-sm"
                placeholder="Empresa S.A."
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                disabled={running}
              />
            </div>
          </div>
          {/* Validación Lusha */}
          <p className={`text-xs mt-2 ${canLusha ? "text-success-fg" : "text-ink-subtle"}`}>
            {canLusha
              ? "✓ Lusha se va a ejecutar"
              : "Sin email ni nombre+empresa → Lusha se omite"}
          </p>
        </div>

        {!currentClient && (
          <div className="flex items-center gap-2 text-warning-fg text-sm">
            <IconAlertCircle size={15} /> Selecciona un cliente en el sidebar primero.
          </div>
        )}

        <button
          type="submit"
          disabled={running || !linkedinUrl.trim() || !currentClient}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {running
            ? <><IconLoader2 size={16} className="animate-spin" /> Buscando…</>
            : <><IconPhone size={16} /> Buscar teléfono (Clay → Lemlist → Lusha)</>}
        </button>
      </form>

      {/* Resultados */}
      {(running || done) && (
        <div className="space-y-3">
          <h2 className="font-semibold text-sm text-ink-muted uppercase tracking-wide">Resultados</h2>

          <div className="grid grid-cols-1 gap-3">
            <ProviderCard
              name="Clay"
              logo={<span className="text-base">🏗</span>}
              result={clay}
              requires="Requiere: LinkedIn URL · Waterfall: LeadMagic → PDL → upcell → Clay → Wiza"
            />
            <ProviderCard
              name="Lemlist"
              logo={<span className="text-base">📧</span>}
              result={lemlist}
              requires="Requiere: LinkedIn URL · Usa campaña staging con findPhone"
            />
            <ProviderCard
              name="Lusha"
              logo={<span className="text-base">🔍</span>}
              result={lusha}
              requires="Requiere: email  ó  nombre + apellido + empresa"
            />
          </div>

          {/* Resumen */}
          {done && (
            <div
              className="rounded-xl p-4 text-sm"
              style={{
                background: found.length > 0 ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.04)",
                border:     found.length > 0 ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(255,255,255,0.1)",
                color:      found.length > 0 ? "#4ade80" : "#64748b",
              }}
            >
              {found.length > 0
                ? `✓ ${found.length} proveedor${found.length > 1 ? "es" : ""} encontró teléfono. Copia el que prefieras y pégalo en HubSpot.`
                : "Ningún proveedor encontró teléfono para este contacto."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
