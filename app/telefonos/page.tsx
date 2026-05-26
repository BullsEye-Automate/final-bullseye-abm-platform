"use client";

import { useState } from "react";
import {
  IconPhone,
  IconSearch,
  IconCheck,
  IconAlertCircle,
  IconRefresh,
  IconLoader2,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";

// ────────────────────────────────────────────────────────────
// Tipos
// ────────────────────────────────────────────────────────────

type LushaResult = {
  found: boolean;
  phone?: string;
  phone_type?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  job_title?: string;
  message?: string;
};

type SearchResult = {
  in_bullseye: boolean;
  contact?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    phone: string | null;
    phone_source: string | null;
    company_name: string | null;
  };
  lusha?: LushaResult;
};

// ────────────────────────────────────────────────────────────
// Página principal
// ────────────────────────────────────────────────────────────

export default function TelefonosPage() {
  const { currentClient } = useClient();

  // Estado del buscador individual
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [searching, setSearching]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [result, setResult]           = useState<SearchResult | null>(null);

  // Estado del botón "Levantar teléfonos de Lemlist"
  const [refreshing, setRefreshing]       = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);
  const [refreshError, setRefreshError]   = useState<string | null>(null);

  // Estado para "Actualizar en BullsEye" (Lusha → Supabase)
  const [updating, setUpdating]         = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);

  // ── Flujo de búsqueda individual ──────────────────────────

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!linkedinUrl.trim()) return;

    setSearching(true);
    setError(null);
    setResult(null);
    setUpdateSuccess(false);

    // Normalizar URL antes de enviar
    const normalizedUrl = normalizeLinkedInUrl(linkedinUrl.trim()) ?? linkedinUrl.trim();

    try {
      // Buscar en BullsEye y consultar Lusha en paralelo
      const [bsRes, lushaRes] = await Promise.all([
        fetch(
          `/api/contacts/search?linkedin_url=${encodeURIComponent(normalizedUrl)}${
            currentClient ? `&client_id=${currentClient.id}` : ""
          }`
        ),
        fetch("/api/lusha/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ linkedin_url: normalizedUrl }),
        }),
      ]);

      const [bsData, lushaData] = await Promise.all([bsRes.json(), lushaRes.json()]);

      if (!bsRes.ok) {
        throw new Error(bsData.error ?? "Error buscando en BullsEye");
      }
      // Lusha puede fallar con 500 si no hay API key — lo manejamos graciosamente
      const lusha: LushaResult = lushaRes.ok ? lushaData : { found: false, message: lushaData.error };

      if (bsData.found) {
        setResult({
          in_bullseye: true,
          contact: bsData.contact,
          lusha,
        });
      } else {
        setResult({
          in_bullseye: false,
          lusha,
        });
      }
    } catch (err: any) {
      setError(err?.message ?? "Error inesperado al buscar");
    } finally {
      setSearching(false);
    }
  }

  // ── Actualizar teléfono Lusha en BullsEye ─────────────────

  async function updatePhone() {
    if (!result?.contact?.id || !result?.lusha?.phone) return;
    setUpdating(true);
    try {
      const res = await fetch("/api/lusha/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedin_url: linkedinUrl.trim(),
          contact_id: result.contact.id,
        }),
      });
      if (res.ok) {
        setUpdateSuccess(true);
        // Reflejar el cambio en el estado local
        setResult((prev) =>
          prev
            ? {
                ...prev,
                contact: prev.contact
                  ? { ...prev.contact, phone: result.lusha?.phone ?? prev.contact.phone, phone_source: "lusha" }
                  : prev.contact,
              }
            : prev
        );
      }
    } catch {
      // silently fail — usuario puede reintentar
    } finally {
      setUpdating(false);
    }
  }

  // ── Levantar teléfonos de Lemlist ─────────────────────────

  async function handleRefreshLemlist() {
    if (!currentClient) return;
    setRefreshing(true);
    setRefreshResult(null);
    setRefreshError(null);
    try {
      const res = await fetch("/api/lemlist/refresh-phones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: currentClient.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRefreshError(data.error ?? "Error al levantar teléfonos");
      } else {
        setRefreshResult(
          data.refreshed === 0
            ? "Sin contactos nuevos con teléfono en Lemlist."
            : `${data.refreshed} contacto${data.refreshed > 1 ? "s" : ""} actualizado${data.refreshed > 1 ? "s" : ""} con teléfono de Lemlist.`
        );
      }
    } catch {
      setRefreshError("Error de red al contactar Lemlist");
    } finally {
      setRefreshing(false);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <header>
        <div className="label">SDR · ENRICHMENT MANUAL</div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">
          ☎ Buscar teléfono con Lusha
        </h1>
        <p className="text-sm text-ink-muted mt-2 max-w-2xl">
          Pega el LinkedIn URL del contacto. Si está en BullsEye o HubSpot, te muestro el
          teléfono de Lemlist (si lo tenemos) y consulto Lusha para el otro número. Si NO está
          en sistema, te muestro lo que Lusha levantó y puedes crearlo con un click. Lusha cobra
          ~1 crédito solo si devuelve teléfono.
        </p>
      </header>

      {/* ── Card: Levantar teléfonos de Lemlist ── */}
      <section className="card">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1">
            <h2 className="font-semibold flex items-center gap-2 mb-2">
              <IconPhone size={16} style={{ color: "#62E0D8" }} />
              Teléfonos de Lemlist → HubSpot
            </h2>
            <p className="text-sm text-ink-muted leading-relaxed">
              Todos los contactos que la app empuja a Lemlist ya salen con phone enrichment
              activado (findPhone), pero Lemlist tarda en levantar el número. Este botón recorre
              los contactos en campaña que todavía no tienen teléfono de Lemlist, se lo pide a
              Lemlist y lo escribe en Supabase (campo phone + phone_source=&apos;lemlist&apos;).
              Córrelo cada tanto — es idempotente.
            </p>
          </div>

          <button
            onClick={handleRefreshLemlist}
            disabled={refreshing || !currentClient}
            className="btn-secondary shrink-0"
            title={!currentClient ? "Selecciona un cliente primero" : undefined}
          >
            {refreshing ? (
              <IconLoader2 size={15} className="animate-spin" />
            ) : (
              <IconRefresh size={15} />
            )}
            {refreshing ? "Levantando…" : "Levantar teléfonos de Lemlist"}
          </button>
        </div>

        {/* Resultado del refresh */}
        {refreshResult && (
          <div
            className="mt-4 flex items-center gap-2 text-sm rounded-lg px-4 py-3"
            style={{ background: "rgba(98,224,216,0.1)", color: "#0F6E56" }}
          >
            <IconCheck size={16} />
            {refreshResult}
          </div>
        )}
        {refreshError && (
          <div className="mt-4 flex items-center gap-2 text-sm text-danger-fg">
            <IconAlertCircle size={16} />
            {refreshError}
          </div>
        )}

        {!currentClient && (
          <p className="mt-3 text-xs text-ink-muted">
            Selecciona un cliente en el sidebar para usar esta función.
          </p>
        )}
      </section>

      {/* ── Card: Búsqueda individual ── */}
      <section className="card space-y-4">
        <form onSubmit={handleSearch} className="space-y-3">
          <div>
            <div className="label mb-1">LinkedIn URL</div>
            <div className="flex gap-2">
              <input
                type="url"
                className="input"
                placeholder="https://www.linkedin.com/in/usuario/"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                disabled={searching}
              />
              <button
                type="submit"
                disabled={searching || !linkedinUrl.trim()}
                className="btn-primary shrink-0"
              >
                {searching ? (
                  <IconLoader2 size={15} className="animate-spin" />
                ) : (
                  <IconSearch size={15} />
                )}
                {searching ? "Buscando…" : "Buscar"}
              </button>
            </div>
            <p className="text-xs text-ink-muted mt-1">
              Tip: aceptamos formato corto (linkedin.com/in/foo) o completo
              (https://www.linkedin.com/in/foo/). Si tiene parámetros de tracking (?utm=...) se
              ignoran.
            </p>
          </div>
        </form>

        {/* Error de búsqueda */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-danger-fg">
            <IconAlertCircle size={15} />
            {error}
          </div>
        )}
      </section>

      {/* ── Resultado de búsqueda ── */}
      {result && (
        <section className="card space-y-4">
          {result.in_bullseye && result.contact ? (
            // ── CASO 1: Encontrado en BullsEye ──
            <>
              <div className="flex items-center gap-2">
                <IconCheck size={18} style={{ color: "#62E0D8" }} />
                <span className="font-medium">Encontrado en BullsEye</span>
              </div>

              <p className="text-sm">
                <span className="font-medium">
                  {[result.contact.first_name, result.contact.last_name]
                    .filter(Boolean)
                    .join(" ") || "—"}
                </span>
                {result.contact.company_name && (
                  <span className="text-ink-muted"> · {result.contact.company_name}</span>
                )}
                {result.contact.job_title && (
                  <span className="text-ink-muted"> · {result.contact.job_title}</span>
                )}
              </p>

              <div className="text-sm">
                <span className="text-ink-muted">Teléfono Lemlist: </span>
                {result.contact.phone ? (
                  <span className="font-medium">{result.contact.phone}</span>
                ) : (
                  <span className="text-ink-muted italic">No disponible</span>
                )}
                {result.contact.phone_source && (
                  <span className="text-xs text-ink-muted ml-2">
                    (fuente: {result.contact.phone_source})
                  </span>
                )}
              </div>

              {/* Resultado de Lusha */}
              {result.lusha?.found && result.lusha.phone && (
                <div
                  className="rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
                  style={{ background: "rgba(98,224,216,0.08)" }}
                >
                  <div className="flex-1 text-sm">
                    <span className="text-ink-muted">Lusha encontró: </span>
                    <span className="font-medium">{result.lusha.phone}</span>
                    {result.lusha.phone_type && (
                      <span className="text-xs text-ink-muted ml-2">
                        (tipo: {result.lusha.phone_type})
                      </span>
                    )}
                  </div>
                  {updateSuccess ? (
                    <span
                      className="text-xs font-medium flex items-center gap-1"
                      style={{ color: "#0F6E56" }}
                    >
                      <IconCheck size={13} />
                      Actualizado
                    </span>
                  ) : (
                    <button
                      onClick={updatePhone}
                      disabled={updating}
                      className="text-xs underline shrink-0 flex items-center gap-1"
                      style={{ color: "#62E0D8" }}
                    >
                      {updating && <IconLoader2 size={12} className="animate-spin" />}
                      Actualizar en BullsEye
                    </button>
                  )}
                </div>
              )}

              {/* Lusha sin teléfono */}
              {result.lusha && !result.lusha.found && (
                <p className="text-sm text-ink-muted">
                  {result.lusha.message ?? "Sin resultados en Lusha para esta URL. No se consumió crédito."}
                </p>
              )}
            </>
          ) : !result.in_bullseye && result.lusha?.found ? (
            // ── CASO 2: No en BullsEye, pero Lusha encontró datos ──
            <>
              <div className="flex items-center gap-2">
                <IconAlertCircle size={18} style={{ color: "#F59E0B" }} />
                <span className="font-medium">No está en BullsEye</span>
              </div>

              <div className="space-y-2">
                <div className="label mb-2">Resultado Lusha</div>
                <div className="rounded-lg p-4 space-y-2 text-sm" style={{ background: "rgba(98,224,216,0.06)" }}>
                  {(result.lusha.first_name || result.lusha.last_name) && (
                    <div>
                      <span className="text-ink-muted">Nombre: </span>
                      <span className="font-medium">
                        {[result.lusha.first_name, result.lusha.last_name]
                          .filter(Boolean)
                          .join(" ")}
                      </span>
                    </div>
                  )}
                  {result.lusha.company_name && (
                    <div>
                      <span className="text-ink-muted">Empresa: </span>
                      <span className="font-medium">{result.lusha.company_name}</span>
                    </div>
                  )}
                  {result.lusha.job_title && (
                    <div>
                      <span className="text-ink-muted">Cargo: </span>
                      <span className="font-medium">{result.lusha.job_title}</span>
                    </div>
                  )}
                  {result.lusha.phone && (
                    <div>
                      <span className="text-ink-muted">Teléfono: </span>
                      <span className="font-medium">{result.lusha.phone}</span>
                      {result.lusha.phone_type && (
                        <span className="text-xs text-ink-muted ml-1">
                          ({result.lusha.phone_type})
                        </span>
                      )}
                    </div>
                  )}
                  {result.lusha.email && (
                    <div>
                      <span className="text-ink-muted">Email: </span>
                      <span className="font-medium">{result.lusha.email}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* TODO: Botón crear contacto */}
              <button className="btn-secondary opacity-50 cursor-not-allowed text-sm" disabled title="Próximamente">
                Crear contacto en BullsEye
              </button>
            </>
          ) : (
            // ── CASO 3: Ni en BullsEye ni en Lusha ──
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <IconAlertCircle size={16} />
              {result.lusha?.message ??
                "Sin resultados en Lusha para esta URL. No se consumió crédito."}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
