"use client";

import { useState } from "react";

// Pedido explícito del usuario (09-11-2026), después de agregar el matching
// por nombre real del contacto (ver desambiguarPorContacto en
// metasSheet.ts): ese fix solo aplica a reuniones nuevas — resolveMeetingClientAndContact
// se dispara de forma lazy (recién al cargar la lista o el detalle), nunca
// en bloque sobre el histórico. Este botón corre /meetings/rematch-all, que
// reintenta el match completo (cliente + contacto/empresa) para TODAS las
// reuniones que todavía no quedaron resueltas limpio ('tentative' o 'none'),
// sin tener que abrir cada una a mano.
export default function RematchMeetingsButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/admin/meetings/rematch-all", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo re-matchear");
        setStatus("error");
        return;
      }
      setTotal(data.total ?? null);
      setStatus("done");
    } catch {
      setError("No se pudo conectar con el backend");
      setStatus("error");
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-2">
      <h2 className="text-sm font-semibold text-gray-900">Re-matchear reuniones sin asociación</h2>
      <p className="text-xs text-gray-500">
        Reintenta el match contra el excel de metas (cliente, contacto, empresa) para todas las reuniones que
        todavía quedaron "pendientes de revisión" o sin ningún match — usalo después de un cambio en cómo Peitho
        matchea (ej. el nombre real del contacto, agregado el 09-11-2026), o si corregiste filas del excel y no
        querés esperar a que cada reunión se reabra sola. Puede tardar varios minutos si hay muchas reuniones
        pendientes.
      </p>
      <button
        onClick={handleClick}
        disabled={status === "loading"}
        className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
        style={{ background: "#251762" }}
      >
        {status === "loading" ? "Re-matcheando…" : "Re-matchear todas"}
      </button>
      {status === "done" && (
        <p className="text-xs" style={{ color: "#1F8A5C" }}>
          Listo — se reintentaron {total ?? "varias"} reuniones. Las que sí tenían fila correspondiente en el excel
          ya deberían verse completas; las que sigan en "—" o con el banner de revisión pendiente es porque
          genuinamente no hay (o no se puede distinguir) una fila que corresponda.
        </p>
      )}
      {status === "error" && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
