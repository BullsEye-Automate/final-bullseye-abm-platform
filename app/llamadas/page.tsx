"use client";

import { useEffect, useState, useCallback } from "react";
import {
  IconPhone,
  IconPhoneCall,
  IconPhoneOff,
  IconRefresh,
  IconLoader2,
  IconAlertCircle,
  IconCheck,
  IconX,
  IconPlus,
  IconClockHour4,
  IconArrowDown,
  IconArrowUp
} from "@tabler/icons-react";

// Tipos para llamadas de HubSpot
type Call = {
  id: string;
  title: string;
  body: string;
  direction: "INBOUND" | "OUTBOUND" | string;
  duration_seconds: number;
  disposition: string;
  disposition_label: string;
  status: string;
  timestamp: string | null;
  created_at: string | null;
};

// Dispositions disponibles para registrar una llamada
const DISPOSITIONS = [
  { value: "9d9162e7-6cf3-4944-bf63-4dff82258764", label: "Conectado" },
  { value: "f240bbac-87c9-4f6e-bf70-924b57d47db7", label: "Voicemail" },
  { value: "73a0d17f-1163-4015-bdd5-ec830791da20", label: "Sin respuesta" },
  { value: "17b47fee-58de-441e-a44c-c6300d46f273", label: "Número incorrecto" }
];

// Formatea duración en segundos como "X min Y seg"
function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} seg`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s} seg`;
}

// Calcula tiempo relativo en español
function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "hace un momento";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} hora${diffH > 1 ? "s" : ""}`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `hace ${diffD} día${diffD > 1 ? "s" : ""}`;
  return date.toLocaleDateString("es", { day: "numeric", month: "short" });
}

export default function LlamadasPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Estado del formulario de nueva llamada
  const [fTitle, setFTitle] = useState("");
  const [fDirection, setFDirection] = useState<"OUTBOUND" | "INBOUND">("OUTBOUND");
  const [fDurationMin, setFDurationMin] = useState("");
  const [fDisposition, setFDisposition] = useState(DISPOSITIONS[0].value);
  const [fBody, setFBody] = useState("");
  const [fContactName, setFContactName] = useState("");
  const [fCompanyName, setFCompanyName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadCalls = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/hubspot/calls", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error cargando llamadas");
      } else {
        setCalls(data.calls ?? []);
      }
    } catch {
      setError("Error de red al cargar llamadas");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  function resetForm() {
    setFTitle("");
    setFDirection("OUTBOUND");
    setFDurationMin("");
    setFDisposition(DISPOSITIONS[0].value);
    setFBody("");
    setFContactName("");
    setFCompanyName("");
    setSaveError(null);
  }

  async function handleSave() {
    if (!fTitle.trim()) {
      setSaveError("El título es requerido.");
      return;
    }
    setSaving(true);
    setSaveError(null);

    // Convertir minutos a segundos
    const durationSeconds = Math.round(parseFloat(fDurationMin || "0") * 60);

    try {
      const res = await fetch("/api/hubspot/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: fTitle.trim(),
          body: fBody.trim(),
          direction: fDirection,
          duration_seconds: durationSeconds,
          disposition: fDisposition,
          contact_name: fContactName.trim() || undefined,
          company_name: fCompanyName.trim() || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "Error guardando la llamada");
      } else {
        setFormOpen(false);
        resetForm();
        setSuccessMsg("Llamada registrada en HubSpot.");
        setTimeout(() => setSuccessMsg(null), 4000);
        await loadCalls();
      }
    } catch {
      setSaveError("Error de red al guardar");
    }
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-end justify-between">
        <div>
          <div className="label">SDR</div>
          <h1 className="text-2xl font-semibold tracking-tight">Llamadas</h1>
          <div className="text-sm text-ink-muted mt-1">
            Registro de llamadas comerciales sincronizado con HubSpot.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadCalls}
            disabled={loading}
            className="btn-secondary"
            title="Refrescar lista"
          >
            {loading ? (
              <IconLoader2 size={15} className="animate-spin" />
            ) : (
              <IconRefresh size={15} />
            )}
            Refrescar
          </button>
          <button
            onClick={() => {
              resetForm();
              setFormOpen(true);
            }}
            className="btn-primary"
          >
            <IconPlus size={16} />
            Registrar llamada
          </button>
        </div>
      </header>

      {/* Feedback de éxito */}
      {successMsg && (
        <div className="card border border-success-bg text-success-fg flex items-center gap-2">
          <IconCheck size={16} />
          {successMsg}
        </div>
      )}

      {/* Formulario de nueva llamada (panel inline) */}
      {formOpen && (
        <section
          className="card space-y-5"
          style={{ border: "2px solid rgba(98,224,216,0.35)" }}
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <IconPhone size={17} />
              Nueva llamada
            </h2>
            <button
              onClick={() => {
                setFormOpen(false);
                resetForm();
              }}
              className="btn-secondary text-xs"
            >
              <IconX size={14} /> Cancelar
            </button>
          </div>

          {/* Título */}
          <div>
            <div className="label mb-1">Título de la llamada *</div>
            <input
              className="input"
              placeholder="Ej: Llamada de seguimiento — contacto inicial"
              value={fTitle}
              onChange={(e) => setFTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Dirección */}
            <div>
              <div className="label mb-2">Dirección</div>
              <div className="flex gap-2">
                {(["OUTBOUND", "INBOUND"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setFDirection(d)}
                    className={`btn flex-1 ${
                      fDirection === d
                        ? "bg-brand text-white"
                        : "bg-white border border-[#E5E2F0] text-ink"
                    }`}
                  >
                    {d === "OUTBOUND" ? (
                      <IconArrowUp size={14} />
                    ) : (
                      <IconArrowDown size={14} />
                    )}
                    {d === "OUTBOUND" ? "Saliente" : "Entrante"}
                  </button>
                ))}
              </div>
            </div>

            {/* Duración */}
            <div>
              <div className="label mb-1">Duración (minutos)</div>
              <input
                type="number"
                min="0"
                step="0.5"
                className="input"
                placeholder="Ej: 3.5"
                value={fDurationMin}
                onChange={(e) => setFDurationMin(e.target.value)}
              />
            </div>
          </div>

          {/* Resultado */}
          <div>
            <div className="label mb-1">Resultado</div>
            <select
              className="input"
              value={fDisposition}
              onChange={(e) => setFDisposition(e.target.value)}
            >
              {DISPOSITIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          {/* Notas */}
          <div>
            <div className="label mb-1">Notas</div>
            <textarea
              className="input min-h-[100px]"
              placeholder="Resumen de la llamada, próximos pasos, objeciones…"
              value={fBody}
              onChange={(e) => setFBody(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Contacto */}
            <div>
              <div className="label mb-1">Nombre del contacto (opcional)</div>
              <input
                className="input"
                placeholder="María García"
                value={fContactName}
                onChange={(e) => setFContactName(e.target.value)}
              />
            </div>

            {/* Empresa */}
            <div>
              <div className="label mb-1">Empresa (opcional)</div>
              <input
                className="input"
                placeholder="Acme S.A."
                value={fCompanyName}
                onChange={(e) => setFCompanyName(e.target.value)}
              />
            </div>
          </div>

          {/* Error de guardado */}
          {saveError && (
            <div className="flex items-center gap-2 text-sm text-danger-fg">
              <IconAlertCircle size={15} />
              {saveError}
            </div>
          )}

          {/* Botón guardar */}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving || !fTitle.trim()}
              className="btn-primary"
            >
              {saving ? (
                <IconLoader2 size={15} className="animate-spin" />
              ) : (
                <IconPhone size={15} />
              )}
              {saving ? "Guardando…" : "Guardar llamada"}
            </button>
          </div>
        </section>
      )}

      {/* Error de carga */}
      {error && !loading && (
        <div className="card border border-danger-bg text-danger-fg flex items-center gap-2">
          <IconAlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Lista de llamadas */}
      {loading ? (
        <div className="flex items-center gap-3 text-ink-muted py-12 justify-center">
          <IconLoader2 size={22} className="animate-spin" />
          <span>Cargando llamadas…</span>
        </div>
      ) : calls.length === 0 && !error ? (
        <div className="card flex items-center gap-3 text-ink-muted">
          <IconPhoneOff size={18} className="shrink-0" />
          No hay llamadas registradas todavía. Crea la primera usando el botón de arriba.
        </div>
      ) : (
        <div className="space-y-3">
          {calls.map((call) => (
            <CallCard key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}

function CallCard({ call }: { call: Call }) {
  const isOutbound = call.direction === "OUTBOUND";

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {/* Ícono de dirección */}
          <div
            className="shrink-0 mt-0.5 rounded-lg p-2"
            style={{
              background: isOutbound
                ? "rgba(98,224,216,0.12)"
                : "rgba(74,222,128,0.12)"
            }}
          >
            {isOutbound ? (
              <IconArrowUp
                size={16}
                style={{ color: "#0F6E56" }}
              />
            ) : (
              <IconArrowDown
                size={16}
                style={{ color: "#15803d" }}
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-semibold truncate">{call.title}</h3>
              {/* Badge dirección */}
              <span
                className="badge shrink-0"
                style={
                  isOutbound
                    ? { background: "rgba(98,224,216,0.15)", color: "#0F6E56" }
                    : { background: "rgba(74,222,128,0.15)", color: "#15803d" }
                }
              >
                {isOutbound ? "Saliente" : "Entrante"}
              </span>
              {/* Badge estado */}
              <span className="badge bg-[#F1EEF7] text-ink-muted">
                {call.status}
              </span>
            </div>

            <div className="flex items-center gap-4 text-xs text-ink-muted flex-wrap">
              {/* Fecha relativa */}
              <span>{timeAgo(call.timestamp ?? call.created_at)}</span>

              {/* Duración */}
              {call.duration_seconds > 0 && (
                <span className="flex items-center gap-1">
                  <IconClockHour4 size={12} />
                  {formatDuration(call.duration_seconds)}
                </span>
              )}

              {/* Resultado */}
              {call.disposition_label && call.disposition_label !== "—" && (
                <span
                  className="badge"
                  style={{ background: "#F4F2FB", color: "#251762" }}
                >
                  {call.disposition_label}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Teléfono decorativo */}
        <IconPhoneCall
          size={15}
          className="shrink-0 text-ink-muted mt-1"
        />
      </div>

      {/* Notas truncadas a 2 líneas */}
      {call.body && (
        <p
          className="text-sm text-ink/80 leading-relaxed"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden"
          }}
        >
          {call.body}
        </p>
      )}
    </div>
  );
}
