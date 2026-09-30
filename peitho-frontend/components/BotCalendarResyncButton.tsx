"use client";

import { useEffect, useState } from "react";

interface GoogleAccountStatus {
  google_account_email: string;
  calendar_watch_enabled: boolean;
  last_sync_ok_at: string | null;
  last_sync_error: string | null;
  last_sync_error_at: string | null;
}

function formatDate(value: string | null): string {
  if (!value) return "nunca";
  return new Date(value).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" });
}

// Estado de sincronización de cada cuenta de Google conectada (pedido
// explícito del usuario, 09-10-2026, después de perder días sin saber que
// bot@peithob2b.com tenía el token roto — invalid_grant, invisible hasta que
// una reunión real no apareció). Se llena solo cada 15 min desde
// catchUpAllActiveChannels (ver calendarWatchRenewal.ts) — un
// last_sync_error no nulo es la alerta a mirar.
function GoogleAccountsStatus() {
  const [accounts, setAccounts] = useState<GoogleAccountStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/calendar/status", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Error");
        return res.json();
      })
      .then((json: GoogleAccountStatus[]) => {
        if (active) setAccounts(json);
      })
      .catch(() => {
        if (active) setError("No se pudo cargar el estado de las cuentas.");
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!accounts) return <p className="text-xs text-gray-400">Cargando estado de cuentas…</p>;
  if (accounts.length === 0) return null;

  return (
    <div className="pt-2 space-y-2">
      <p className="text-xs font-medium text-gray-500">Cuentas de Google conectadas</p>
      <ul className="space-y-1.5">
        {accounts.map((a) => (
          <li key={a.google_account_email} className="text-xs flex items-start gap-2">
            {a.last_sync_error ? (
              <span className="shrink-0 text-red-600 font-semibold">⚠</span>
            ) : (
              <span className="shrink-0" style={{ color: "#1F8A5C" }}>
                ●
              </span>
            )}
            <span>
              <span className="text-gray-700 font-medium">{a.google_account_email}</span>{" "}
              {a.last_sync_error ? (
                <span className="text-red-600">
                  — con error desde {formatDate(a.last_sync_error_at)}: {a.last_sync_error}
                </span>
              ) : (
                <span className="text-gray-400">— última sincronización ok: {formatDate(a.last_sync_ok_at)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Pedido explícito del usuario (08-10-2026, reunión de Callegari
// Automotriz/OTIC CChC): una invitación al bot con un link de reunión válido
// igual no apareció en Peitho, y el truco de sacar/re-agregar a
// bot@peithob2b.com como invitado (que sirvió en un caso anterior) no
// funciona acá porque ella no es la dueña de esa cita — solo el organizador
// puede editar invitados. Este botón fuerza lo mismo desde el lado de
// Peitho: una resincronización COMPLETA del calendario del bot (no
// incremental), que reintenta absolutamente todos los eventos de los
// próximos 90 días, hayan cambiado o no desde la última vez.
export default function BotCalendarResyncButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/admin/calendar/bot-resync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo resincronizar");
        setStatus("error");
        return;
      }
      setStatus("done");
    } catch {
      setError("No se pudo conectar con el backend");
      setStatus("error");
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-2">
      <h2 className="text-sm font-semibold text-gray-900">Calendario del bot de Recall</h2>
      <p className="text-xs text-gray-500">
        Fuerza una resincronización completa del calendario de <code>bot@peithob2b.com</code> (los próximos 90 días,
        no solo lo que cambió desde la última vez) — usalo cuando una invitación al bot con link válido no aparece en
        "Reuniones futuras" y no podés sacar/volver a agregar al bot vos misma (porque no sos la dueña de esa cita).
      </p>
      <button
        onClick={handleClick}
        disabled={status === "loading"}
        className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
        style={{ background: "#251762" }}
      >
        {status === "loading" ? "Resincronizando…" : "Resincronizar calendario del bot"}
      </button>
      {status === "done" && (
        <p className="text-xs" style={{ color: "#1F8A5C" }}>
          Listo — se volvió a procesar todo el calendario. Si la reunión que faltaba tenía un problema real (no solo
          de sincronización), va a seguir sin aparecer — avisame y reviso los logs de Railway de este momento.
        </p>
      )}
      {status === "error" && <p className="text-xs text-red-600">{error}</p>}

      <GoogleAccountsStatus />
    </div>
  );
}
