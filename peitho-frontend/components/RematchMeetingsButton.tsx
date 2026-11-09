"use client";

import { useState } from "react";
import Link from "next/link";

interface PendienteRow {
  id: string;
  contraparte: string | null;
  empresa_contraparte: string | null;
  start_time: string | null;
  contacto_match_status: string;
  client_id: string | null;
  candidatos: number;
}

function formatDate(value: string | null): string {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Santiago",
  });
}

// El número real de candidatos (no un "2+" fijo — un 'tentative' puede
// quedar con 1 solo candidato cuando sí hay alguna relación de texto parcial
// que lo salva de caer a 'none', ver metasSheet.ts) para no mostrar un
// conteo que no corresponde al caso real.
function estadoLabel(m: PendienteRow): string {
  if (m.contacto_match_status === "tentative") {
    return `Ambiguo — ${m.candidatos} candidato${m.candidatos === 1 ? "" : "s"}`;
  }
  return "Sin match en el excel";
}

// Pedido explícito del usuario (09-11-2026), después de agregar el matching
// por nombre real del contacto (ver desambiguarPorContacto en
// metasSheet.ts): ese fix solo aplica a reuniones nuevas — resolveMeetingClientAndContact
// se dispara de forma lazy (recién al cargar la lista o el detalle), nunca
// en bloque sobre el histórico. Este botón corre /meetings/rematch-all, que
// reintenta el match completo (cliente + contacto/empresa) para TODAS las
// reuniones que todavía no quedaron resueltas limpio ('tentative' o 'none'),
// sin tener que abrir cada una a mano.
//
// Mismo día, pedido explícito del usuario tras el primer uso ("hay como
// saber cuántas funcionaron y cuáles quedan pendientes?"): el resultado
// ahora desglosa cuántas quedaron resueltas vs. pendientes, y lista cada
// pendiente (fecha, contraparte, dominio, por qué sigue pendiente) con link
// directo al detalle — en vez de un conteo ciego sin poder actuar sobre él.
export default function RematchMeetingsButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [total, setTotal] = useState<number | null>(null);
  const [resueltas, setResueltas] = useState<number | null>(null);
  const [pendientes, setPendientes] = useState<PendienteRow[]>([]);
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
      setResueltas(data.resueltas ?? null);
      setPendientes(data.pendientes ?? []);
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
      {status === "done" && total !== null && (
        <div className="space-y-3 pt-1">
          <p className="text-xs" style={{ color: "#1F8A5C" }}>
            Listo — se reintentaron {total} reuniones: {resueltas ?? 0} quedaron resueltas,{" "}
            {pendientes.length} siguen pendientes.
          </p>
          {pendientes.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500">
                Pendientes — genuinamente no hay (o no se puede distinguir) una fila del excel que corresponda:
              </p>
              <ul className="space-y-1 max-h-80 overflow-y-auto">
                {pendientes.map((m) => (
                  <li key={m.id} className="text-xs border-b border-gray-50 pb-1.5">
                    <Link href={`/reuniones/${m.id}`} className="hover:underline" style={{ color: "#251762" }}>
                      {m.contraparte ?? "Sin nombre"}
                      {m.empresa_contraparte ? ` — ${m.empresa_contraparte}` : ""}
                    </Link>
                    <span className="text-gray-400">
                      {" "}
                      · {formatDate(m.start_time)} ·{" "}
                      {estadoLabel(m)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {status === "error" && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
