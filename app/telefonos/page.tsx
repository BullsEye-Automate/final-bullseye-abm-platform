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
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";

// ── Tipos ──────────────────────────────────────────────────────

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

  // Estado por proveedor (independiente)
  const [clay,    setClay]    = useState<Result>(IDLE);
  const [lemlist, setLemlist] = useState<Result>(IDLE);

  function resetAll() {
    setClay(IDLE);
    setLemlist(IDLE);
  }

  // ── Runners por proveedor ────────────────────────────────────

  async function runClay() {
    if (!linkedinUrl.trim() || !currentClient?.id) return;
    const url = normalizeLinkedInUrl(linkedinUrl.trim()) ?? linkedinUrl.trim();
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
    setLemlist({ status: "running", phone: null, detail: "Buscando con Lemlist (findPhone + Lusha integrado)…" });

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
        setLemlist({ status: "error", phone: null, detail: first.data.error ?? "Error en Lemlist", debug: first.data.debug || first.data });
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
        detail: "Lemlist está enriqueciendo el contacto (con Lusha integrado). Te avisamos en cuanto aparezca el teléfono…",
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
        detail: "Después de 2 minutos Lemlist (con Lusha integrado) no devolvió teléfono.",
        debug: lastDebug,
      });
    } catch {
      setLemlist({ status: "error", phone: null, detail: "Error de conexión con Lemlist" });
    }
  }

  // ── Render ───────────────────────────────────────────────────

  const anyRunning = clay.status === "running" || lemlist.status === "running";
  const clayDone    = clay.status === "found"    || clay.status === "not_found"    || clay.status === "error";
  const lemlistDone = lemlist.status === "found" || lemlist.status === "not_found" || lemlist.status === "error";

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <header>
        <div className="label">SDR · Enriquecimiento de Teléfonos</div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Buscar teléfono</h1>
        <p className="text-sm text-ink-muted mt-1">
          Elige el proveedor: <strong>Clay</strong> (waterfall de 5, recomendado) o <strong>Lemlist</strong> (findPhone + Lusha integrado).
          Solo necesitas LinkedIn URL.
        </p>
      </header>

      {/* Instrucciones */}
      <div className="rounded-xl p-4 space-y-2" style={{ background: "#eef9f8", border: "1px solid #62E0D8" }}>
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#0c5e58" }}>
          <IconInfoCircle size={16} /> Cómo funciona
        </div>
        <ol className="text-sm space-y-1 list-decimal list-inside" style={{ color: "#0f4f4a" }}>
          <li>Pega el LinkedIn URL del contacto (obligatorio).</li>
          <li>Presiona <strong>Buscar con Clay</strong> (waterfall de 5 proveedores, 1-3 min) o <strong>Buscar con Lemlist</strong> (findPhone + Lusha, 10-30s).</li>
          <li>Elige el teléfono que prefieras y cópialo con el botón <strong>Copiar</strong> para pegar en HubSpot.</li>
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


        {!currentClient && (
          <div className="flex items-center gap-2 text-warning-fg text-sm">
            <IconAlertCircle size={15} /> Selecciona un cliente en el sidebar primero.
          </div>
        )}

        {/* Botones: Clay y Lemlist independientes */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={runClay}
            disabled={anyRunning || !linkedinUrl.trim() || !currentClient}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
          >
            <IconPhone size={16} />
            Buscar con Clay
          </button>
          <button
            onClick={runLemlist}
            disabled={anyRunning || !linkedinUrl.trim() || !currentClient}
            className="btn-secondary flex-1 flex items-center justify-center gap-2"
          >
            <IconPhone size={16} />
            Buscar con Lemlist
          </button>
        </div>

        {/* Resetear */}
        {(clayDone || lemlistDone) && (
          <button
            onClick={() => { resetAll(); setLinkedinUrl(""); }}
            className="text-xs text-ink-muted hover:text-ink-fg underline"
          >
            ← Resetear y buscar otro contacto
          </button>
        )}
      </div>

      {/* Resultados — Clay y Lemlist independientes */}
      {(clay.status !== "idle" || lemlist.status !== "idle") && (
        <div className="space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide" style={{ color: "#251762" }}>Resultados</h2>

          {/* Clay */}
          {clay.status !== "idle" && (
            <ResultCard
              name="Clay"
              emoji="🏗"
              result={clay}
              requires="Waterfall de 5 proveedores: LeadMagic → PDL → upcell → Clay → Wiza"
            />
          )}

          {/* Lemlist */}
          {lemlist.status !== "idle" && (
            <ResultCard
              name="Lemlist"
              emoji="📧"
              result={lemlist}
              requires="findPhone + Lusha integrado. Si el contacto ya estaba, devolvemos el teléfono guardado sin consumir créditos."
            />
          )}

          {/* Resumen final cuando hay al menos un resultado */}
          {(clayDone || lemlistDone) && (
            <div
              className="rounded-xl p-4 text-sm"
              style={
                clay.status === "found" || lemlist.status === "found"
                  ? { background: "#e8f6ed", border: "1px solid #22c55e", color: "#166534" }
                  : { background: "#f8f9fb", border: "1px solid #cbd5e1", color: "#475569" }
              }
            >
              {clay.status === "found" || lemlist.status === "found"
                ? "✓ Ya tienes al menos un teléfono. Copia el que prefieras y pégalo en HubSpot."
                : "Ningún proveedor encontró teléfono para este contacto. Reintenta más tarde."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
