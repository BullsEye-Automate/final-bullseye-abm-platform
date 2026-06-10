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
  IconArrowRight,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";

// ── Tipos ──────────────────────────────────────────────────────

type Step = "clay" | "lemlist" | "lusha";

type Result = {
  status: "idle" | "running" | "found" | "not_found" | "error";
  phone: string | null;
  detail: string | null;
  debug?: any;
};
const IDLE: Result = { status: "idle", phone: null, detail: null };

// ── Helpers ────────────────────────────────────────────────────

function CopyButton({ text, large = false }: { text: string; large?: boolean }) {
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
      className={`inline-flex items-center gap-1.5 rounded font-medium transition-colors ${large ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs"}`}
      style={{
        background: copied ? "#62E0D8" : "#251762",
        color:      copied ? "#251762" : "#ffffff",
      }}
    >
      {copied ? <IconCheck size={large ? 16 : 14} /> : <IconCopy size={large ? 16 : 14} />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

function ResultCard({
  name,
  emoji,
  result,
  requires,
}: {
  name: string;
  emoji: string;
  result: Result;
  requires: string;
}) {
  const palette = {
    idle:      { bg: "#f4f4f7", border: "#e5e5ec", title: "#475569", body: "#64748b" },
    running:   { bg: "#eef9f8", border: "#62E0D8", title: "#0c5e58", body: "#0c5e58" },
    found:     { bg: "#e8f6ed", border: "#22c55e", title: "#166534", body: "#15803d" },
    not_found: { bg: "#f8f9fb", border: "#cbd5e1", title: "#334155", body: "#475569" },
    error:     { bg: "#fdecec", border: "#ef4444", title: "#991b1b", body: "#991b1b" },
  }[result.status];

  return (
    <div className="rounded-xl p-4 space-y-2" style={{ background: palette.bg, border: `1px solid ${palette.border}` }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">{emoji}</span>
          <span className="font-semibold text-sm" style={{ color: palette.title }}>{name}</span>
        </div>
        {result.status === "running" && <IconLoader2 size={16} className="animate-spin" style={{ color: palette.title }} />}
        {result.status === "found"   && <IconCheck size={16} style={{ color: palette.title }} />}
      </div>
      <p className="text-xs" style={{ color: palette.body }}>{requires}</p>

      {result.status === "running" && (
        <p className="text-sm" style={{ color: palette.body }}>{result.detail ?? "Buscando…"}</p>
      )}
      {result.status === "found" && result.phone && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="font-mono text-lg font-semibold" style={{ color: palette.title }}>{result.phone}</span>
          <CopyButton text={result.phone} large />
        </div>
      )}
      {result.status === "not_found" && (
        <p className="text-sm" style={{ color: palette.body }}>{result.detail ?? "No encontró teléfono"}</p>
      )}
      {result.status === "error" && (
        <p className="text-sm" style={{ color: palette.body }}>{result.detail ?? "Error"}</p>
      )}

      {result.debug && (result.status === "not_found" || result.status === "running" || result.status === "error") && (
        <details className="mt-1">
          <summary className="text-xs cursor-pointer" style={{ color: palette.body }}>
            🔍 Detalles técnicos (debug)
          </summary>
          <pre className="text-[10px] mt-2 p-2 rounded overflow-auto" style={{ background: "#1e1b3a", color: "#e2e8f0", maxHeight: "70vh" }}>
            {JSON.stringify(result.debug, null, 2)}
          </pre>
        </details>
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

  // Estado por proveedor (independiente)
  const [clay,    setClay]    = useState<Result>(IDLE);
  const [lemlist, setLemlist] = useState<Result>(IDLE);
  const [lusha,   setLusha]   = useState<Result>(IDLE);

  // Indica si se ejecutó al menos Clay (para mostrar la zona de resultados)
  const [started, setStarted] = useState(false);

  const canLushaEmail = !!email.trim();
  const canLushaTrio  = !!firstName.trim() && !!lastName.trim() && !!company.trim();
  const canLusha      = canLushaEmail || canLushaTrio;

  function resetAll() {
    setClay(IDLE);
    setLemlist(IDLE);
    setLusha(IDLE);
    setStarted(false);
  }

  // ── Runners por proveedor ────────────────────────────────────

  async function runClay() {
    if (!linkedinUrl.trim() || !currentClient?.id) return;
    const url = normalizeLinkedInUrl(linkedinUrl.trim()) ?? linkedinUrl.trim();
    setStarted(true);
    setLemlist(IDLE);
    setLusha(IDLE);
    setClay({ status: "running", phone: null, detail: "Enviando a Clay (waterfall LeadMagic → PDL → upcell → Clay → Wiza)…" });

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
        return;
      }
      setClay({ status: "running", phone: null, detail: "Clay corriendo waterfall (1-3 min)…" });

      const deadline = Date.now() + 3 * 60 * 1000;
      const phone = await new Promise<string | null>((resolve) => {
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

      if (phone) {
        setClay({ status: "found", phone, detail: null });
      } else {
        setClay({ status: "not_found", phone: null, detail: "Clay no encontró teléfono en 3 minutos. Puede llegar tarde a HubSpot automáticamente." });
      }
    } catch {
      setClay({ status: "error", phone: null, detail: "Error de conexión con Clay" });
    }
  }

  async function runLemlist() {
    if (!linkedinUrl.trim() || !currentClient?.id) return;
    const url = normalizeLinkedInUrl(linkedinUrl.trim()) ?? linkedinUrl.trim();
    setLemlist({ status: "running", phone: null, detail: "Buscando con Lemlist (findPhone)…" });

    async function callOnce() {
      const r = await fetch("/api/lemlist/lookup-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: currentClient!.id, linkedin_url: url }),
      });
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok, data: d };
    }

    try {
      // Primer intento
      const first = await callOnce();
      if (!first.ok) {
        setLemlist({ status: "error", phone: null, detail: first.data.error ?? "Error en Lemlist" });
        return;
      }
      if (first.data.found && first.data.phone) {
        setLemlist({
          status: "found",
          phone: first.data.phone,
          detail: first.data.message ?? (first.data.cached ? "Contacto ya estaba en la campaña. Sin consumir créditos." : null),
        });
        return;
      }

      // Procesando: reintentar en background cada 5s hasta 2 min (24 intentos).
      // El endpoint es idempotente: busca primero en Lemlist y en HubSpot antes de pushear,
      // así que no consume créditos extra.
      setLemlist({
        status: "running",
        phone: null,
        detail: "Lemlist está enriqueciendo el contacto. Te avisamos en cuanto aparezca el teléfono…",
      });

      let lastDebug: any = first.data.debug;
      const maxAttempts = 24;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, 5_000));
        try {
          const next = await callOnce();
          if (next.ok && next.data.found && next.data.phone) {
            setLemlist({
              status: "found",
              phone: next.data.phone,
              detail: next.data.message ?? "Lemlist terminó el enriquecimiento.",
            });
            return;
          }
          lastDebug = next.data.debug ?? lastDebug;
          const elapsed = attempt * 5;
          setLemlist({
            status: "running",
            phone: null,
            detail: `Lemlist sigue procesando (${elapsed}s)… puedes seguir trabajando, te aviso cuando esté.`,
            debug: lastDebug,
          });
        } catch { /* reintenta */ }
      }

      setLemlist({
        status: "not_found",
        phone: null,
        detail: "Después de 2 minutos Lemlist no devolvió teléfono. Reintenta más tarde o avanza a Lusha.",
        debug: lastDebug,
      });
    } catch {
      setLemlist({ status: "error", phone: null, detail: "Error de conexión con Lemlist" });
    }
  }

  async function runLusha() {
    if (!canLusha) {
      setLusha({ status: "not_found", phone: null, detail: "Faltan datos: completa Email o el trío Nombre+Apellido+Empresa." });
      return;
    }
    const url = normalizeLinkedInUrl(linkedinUrl.trim()) ?? linkedinUrl.trim();
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
        setLusha({ status: "error", phone: null, detail: d.error ?? "Error en Lusha", debug: d.debug });
      } else if (d.found && d.phone) {
        setLusha({ status: "found", phone: d.phone, detail: null });
      } else {
        setLusha({ status: "not_found", phone: null, detail: d.message ?? "Lusha no encontró este contacto", debug: d.debug });
      }
    } catch {
      setLusha({ status: "error", phone: null, detail: "Error de conexión con Lusha" });
    }
  }

  // ── Render ───────────────────────────────────────────────────

  const anyRunning = clay.status === "running" || lemlist.status === "running" || lusha.status === "running";
  const clayDone    = clay.status === "found"    || clay.status === "not_found"    || clay.status === "error";
  const lemlistDone = lemlist.status === "found" || lemlist.status === "not_found" || lemlist.status === "error";
  const lushaDone   = lusha.status === "found"   || lusha.status === "not_found"   || lusha.status === "error";

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <header>
        <div className="label">SDR · Enriquecimiento de Teléfonos</div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Buscar teléfono</h1>
        <p className="text-sm text-ink-muted mt-1">
          Cascada manual paso a paso: empieza con <strong>Clay</strong>; si el número no sirve,
          avanza a <strong>Lemlist</strong> y luego a <strong>Lusha</strong>. No consume créditos extra
          mientras no avances.
        </p>
      </header>

      {/* Instrucciones */}
      <div className="rounded-xl p-4 space-y-2" style={{ background: "#eef9f8", border: "1px solid #62E0D8" }}>
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#0c5e58" }}>
          <IconInfoCircle size={16} /> Cómo funciona
        </div>
        <ol className="text-sm space-y-1 list-decimal list-inside" style={{ color: "#0f4f4a" }}>
          <li>Pega el LinkedIn URL del contacto.</li>
          <li><strong>Clay</strong> corre primero (waterfall de 5 proveedores, 1-3 min). Solo necesita LinkedIn URL.</li>
          <li>Si el teléfono de Clay no sirve, presiona <strong>Buscar en Lemlist</strong> (findPhone, 10-30s).</li>
          <li>Si tampoco, presiona <strong>Buscar en Lusha</strong>. Lusha necesita Email <em>o</em> Nombre+Apellido+Empresa.</li>
          <li>Cada número aparece con un botón <strong>Copiar</strong> para pegar en HubSpot.</li>
        </ol>
      </div>

      {/* Formulario */}
      <div className="card space-y-5">
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
            disabled={anyRunning}
          />
        </div>

        {/* Datos para Lusha */}
        <div className="rounded-lg border border-ink-subtle/20 p-4 space-y-3" style={{ background: "#fafafc" }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#251762" }}>
              Datos para Lusha
            </p>
            <p className="text-xs text-ink-muted mt-1">
              Solo necesarios si Clay y Lemlist no encuentran el número. Completa <strong>una</strong> de las dos opciones:
            </p>
          </div>

          {/* Opción A: Email */}
          <div className="rounded p-3" style={{ background: canLushaEmail ? "#e8f6ed" : "#ffffff", border: `1px solid ${canLushaEmail ? "#22c55e" : "#e5e5ec"}` }}>
            <div className="text-xs font-semibold mb-2" style={{ color: canLushaEmail ? "#166534" : "#251762" }}>
              OPCIÓN A — Email
            </div>
            <label className="label flex items-center gap-1 mb-1">
              <IconMail size={13} /> Email <span className="text-danger-fg">*</span>
            </label>
            <input
              className="input text-sm"
              placeholder="correo@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={anyRunning}
            />
          </div>

          <div className="text-center text-xs font-semibold" style={{ color: "#251762" }}>
            — O —
          </div>

          {/* Opción B: trío */}
          <div className="rounded p-3" style={{ background: canLushaTrio ? "#e8f6ed" : "#ffffff", border: `1px solid ${canLushaTrio ? "#22c55e" : "#e5e5ec"}` }}>
            <div className="text-xs font-semibold mb-2" style={{ color: canLushaTrio ? "#166534" : "#251762" }}>
              OPCIÓN B — Nombre + Apellido + Empresa (los 3)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="label flex items-center gap-1 mb-1">
                  <IconUser size={13} /> Nombre <span className="text-danger-fg">*</span>
                </label>
                <input
                  className="input text-sm"
                  placeholder="Juan"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={anyRunning}
                />
              </div>
              <div>
                <label className="label flex items-center gap-1 mb-1">
                  <IconUser size={13} /> Apellido <span className="text-danger-fg">*</span>
                </label>
                <input
                  className="input text-sm"
                  placeholder="Pérez"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={anyRunning}
                />
              </div>
              <div>
                <label className="label flex items-center gap-1 mb-1">
                  <IconBuilding size={13} /> Empresa <span className="text-danger-fg">*</span>
                </label>
                <input
                  className="input text-sm"
                  placeholder="Empresa S.A."
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  disabled={anyRunning}
                />
              </div>
            </div>
          </div>

          <p className="text-xs" style={{ color: canLusha ? "#15803d" : "#64748b" }}>
            {canLusha ? "✓ Datos suficientes para ejecutar Lusha cuando lo necesites." : "Sin Email ni el trío completo, Lusha se omite."}
          </p>
        </div>

        {!currentClient && (
          <div className="flex items-center gap-2 text-warning-fg text-sm">
            <IconAlertCircle size={15} /> Selecciona un cliente en el sidebar primero.
          </div>
        )}

        {/* Botón inicial: empezar con Clay */}
        {!started && (
          <button
            onClick={runClay}
            disabled={anyRunning || !linkedinUrl.trim() || !currentClient}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <IconPhone size={16} />
            Buscar teléfono (empieza por Clay)
          </button>
        )}

        {started && (
          <button
            onClick={() => { resetAll(); }}
            className="text-xs text-ink-muted hover:text-ink-fg underline"
          >
            ← Resetear y buscar otro contacto
          </button>
        )}
      </div>

      {/* Resultados paso a paso */}
      {started && (
        <div className="space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide" style={{ color: "#251762" }}>Resultados</h2>

          {/* Paso 1 — Clay */}
          <ResultCard
            name="Clay"
            emoji="🏗"
            result={clay}
            requires="Waterfall de 5 proveedores: LeadMagic → PDL → upcell → Clay → Wiza"
          />

          {/* Si Clay terminó y aún no se corrió Lemlist, mostrar botón de avance */}
          {clayDone && lemlist.status === "idle" && (
            <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: "#fafafc", border: "1px solid #cbd5e1" }}>
              <p className="text-sm" style={{ color: "#251762" }}>
                {clay.status === "found"
                  ? "¿El teléfono de Clay no te sirve? Avanza al siguiente proveedor."
                  : "Clay no encontró número. Prueba con Lemlist."}
              </p>
              <button
                onClick={runLemlist}
                disabled={anyRunning}
                className="btn-secondary flex items-center justify-center gap-2 w-full sm:w-auto"
              >
                <IconArrowRight size={15} />
                Buscar en Lemlist
              </button>
            </div>
          )}

          {/* Paso 2 — Lemlist */}
          {lemlist.status !== "idle" && (
            <ResultCard
              name="Lemlist"
              emoji="📧"
              result={lemlist}
              requires="findPhone sobre la campaña staging. Si el contacto ya estaba, devolvemos el teléfono guardado sin consumir créditos."
            />
          )}

          {/* Si Lemlist terminó y aún no se corrió Lusha */}
          {lemlistDone && lusha.status === "idle" && (
            <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: "#fafafc", border: "1px solid #cbd5e1" }}>
              <p className="text-sm" style={{ color: "#251762" }}>
                {lemlist.status === "found"
                  ? "¿El teléfono de Lemlist tampoco te sirve? Último intento con Lusha."
                  : "Lemlist no encontró número. Prueba con Lusha."}
              </p>
              {!canLusha && (
                <p className="text-xs" style={{ color: "#991b1b" }}>
                  ⚠ Faltan datos para Lusha — completa Email o el trío Nombre+Apellido+Empresa arriba.
                </p>
              )}
              <button
                onClick={runLusha}
                disabled={anyRunning || !canLusha}
                className="btn-secondary flex items-center justify-center gap-2 w-full sm:w-auto"
              >
                <IconArrowRight size={15} />
                Buscar en Lusha
              </button>
            </div>
          )}

          {/* Paso 3 — Lusha */}
          {lusha.status !== "idle" && (
            <ResultCard
              name="Lusha"
              emoji="🔍"
              result={lusha}
              requires="Necesita Email o Nombre + Apellido + Empresa"
            />
          )}

          {/* Resumen final cuando todo terminó */}
          {clayDone && (lemlistDone || lemlist.status === "idle") && (lushaDone || lusha.status === "idle") && (
            <div
              className="rounded-xl p-4 text-sm"
              style={
                clay.status === "found" || lemlist.status === "found" || lusha.status === "found"
                  ? { background: "#e8f6ed", border: "1px solid #22c55e", color: "#166534" }
                  : { background: "#f8f9fb", border: "1px solid #cbd5e1", color: "#475569" }
              }
            >
              {clay.status === "found" || lemlist.status === "found" || lusha.status === "found"
                ? "✓ Ya tienes al menos un teléfono. Copia el que prefieras y pégalo en HubSpot."
                : (lushaDone || (lemlistDone && !canLusha))
                  ? "Ningún proveedor encontró teléfono para este contacto."
                  : "Sigue avanzando en la cascada para probar otros proveedores."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
