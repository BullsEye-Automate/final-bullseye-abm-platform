"use client";

import { useState } from "react";

// Compartir el research con el cliente externo (10-09-2026), pedido
// explícito del usuario: genera/reusa un link público de solo lectura para
// ESTA reunión (POST /api/meetings/:id/research/share, proxy hacia el
// backend) y lo muestra listo para copiar. "Revocar" invalida el link viejo
// — un "Compartir" posterior genera uno nuevo, distinto.
export default function ShareResearchButton({
  meetingId,
  initialToken,
}: {
  meetingId: string;
  initialToken: string | null;
}) {
  const [token, setToken] = useState(initialToken);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = token && typeof window !== "undefined" ? `${window.location.origin}/research-compartido/${token}` : null;

  async function handleShare() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/research/share`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo generar el link");
        return;
      }
      setToken(data.token);
    } catch {
      setError("No se pudo generar el link");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke() {
    if (!window.confirm("¿Revocar el link? Deja de funcionar de inmediato para quien lo tenga guardado.")) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/research/share`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo revocar el link");
        return;
      }
      setToken(null);
    } catch {
      setError("No se pudo revocar el link");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard puede fallar por permisos del navegador — el link ya
      // queda visible en el input para copiar a mano igual.
    }
  }

  if (!url) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={handleShare}
          disabled={loading}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 transition disabled:opacity-50 hover:bg-gray-50"
        >
          {loading ? "Generando…" : "Compartir con el cliente"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          onClick={(e) => (e.target as HTMLInputElement).select()}
          className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50 w-64 truncate"
        />
        <button
          onClick={handleCopy}
          className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-white transition"
          style={{ background: "#251762" }}
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
        <button
          onClick={handleRevoke}
          disabled={loading}
          className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-red-600 transition disabled:opacity-50 hover:bg-red-50"
        >
          Revocar
        </button>
      </div>
      <p className="text-[11px] text-gray-400">Solo puede ver el research de esta reunión — no necesita login.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
