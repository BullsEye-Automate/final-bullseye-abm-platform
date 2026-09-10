"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SyncResult {
  filas: number;
  creados: number;
  actualizados: number;
  sinCambios: number;
  omitidos: number;
}

// Pedido explícito del usuario (10-09-2026): traer a Peitho todos los
// clientes ACTIVOS de la maestra de BullsEye (otra pestaña del mismo excel
// de metas), cada uno con el mismo "ID Cliente" que usa otra herramienta
// interna para poder vincularlos. Reusable — la maestra puede cambiar, así
// que esto no es un script de una sola vez.
export default function SyncMaestraButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/clients/sync-maestra", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo sincronizar");
        return;
      }
      setResult(data);
      router.refresh();
    } catch {
      setError("No se pudo sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        onClick={handleClick}
        disabled={syncing}
        className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 transition disabled:opacity-50"
      >
        {syncing ? "Sincronizando…" : "Sincronizar clientes desde la maestra"}
      </button>
      {error && <p className="text-xs text-red-600 max-w-xs text-right">{error}</p>}
      {result && (
        <p className="text-xs text-gray-500 max-w-xs text-right">
          {result.creados} nuevo{result.creados === 1 ? "" : "s"}, {result.actualizados} actualizado
          {result.actualizados === 1 ? "" : "s"}, {result.sinCambios} sin cambios, {result.omitidos} omitido
          {result.omitidos === 1 ? "" : "s"} (inactivos o sin nombre) — {result.filas} filas en total.
        </p>
      )}
    </div>
  );
}
