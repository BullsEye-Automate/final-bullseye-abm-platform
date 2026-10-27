"use client";

import { useCallback, useEffect, useState } from "react";
import { IconCopy, IconLoader2, IconUserPlus } from "@tabler/icons-react";

// Accesos al portal de clientes (usuarios por cliente). Se usa en
// Configuración → Cliente y en Solicitudes clientes → Accesos al portal.
// Cada usuario queda ligado a un solo cliente (client_users + rol "client"
// en Supabase Auth) y en el portal solo ve la información de esa cuenta.
// La contraseña temporal se muestra una sola vez.

type PortalUserRow = { id: string; client_name: string; email: string; full_name: string | null; is_active: boolean; created_by: string | null; created_at: string };

export default function PortalAccessManager({ clientId, clientName }: { clientId: string | null; clientName: string | null }) {
  const [users, setUsers] = useState<PortalUserRow[] | null>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    const qs = clientId ? `?client_id=${clientId}` : "";
    const r = await fetch(`/api/portal-admin/users${qs}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) return setError(j.error ?? "Error al cargar");
    setUsers(j.users);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/portal-admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, email, full_name: fullName }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(j.error ?? "Error");
    setCredentials({ email: j.email, password: j.password });
    setEmail("");
    setFullName("");
    load();
  }

  async function act(u: PortalUserRow, action: "deactivate" | "activate" | "reset_password" | "delete") {
    if (action === "delete" && !confirm(`¿Eliminar el acceso de ${u.email}?`)) return;
    setError(null);
    const r = await fetch(`/api/portal-admin/users/${u.id}`, {
      method: action === "delete" ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: action === "delete" ? undefined : JSON.stringify({ action }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.error ?? "Error");
    if (action === "reset_password") setCredentials({ email: u.email, password: j.password });
    load();
  }

  const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";

  return (
    <div className="space-y-6">
      {clientId ? (
        <form onSubmit={create} className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-wrap items-end gap-3">
          <div className="w-full text-sm font-medium" style={{ color: "#251762" }}>Nuevo acceso para {clientName}</div>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre" className="flex-1 min-w-[180px] border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@cliente.com" type="email" required className="flex-1 min-w-[220px] border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          <button disabled={busy} className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm text-white disabled:opacity-50" style={{ background: "#251762" }}>
            {busy ? <IconLoader2 size={14} className="animate-spin" /> : <IconUserPlus size={14} />} Crear acceso
          </button>
        </form>
      ) : (
        <div className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">Selecciona un cliente en el menú lateral para crearle accesos.</div>
      )}

      {credentials && (
        <div className="rounded-2xl border p-5 text-sm" style={{ background: "rgba(98,224,216,0.1)", borderColor: "rgba(98,224,216,0.4)" }}>
          <div className="font-medium mb-2" style={{ color: "#251762" }}>Credenciales (se muestran una sola vez)</div>
          <pre className="bg-white rounded-xl p-3 text-xs whitespace-pre-wrap">{`Portal BullsEye: ${loginUrl}\nUsuario: ${credentials.email}\nContraseña temporal: ${credentials.password}\n\nTe recomendamos cambiarla en "Mi cuenta" al ingresar.`}</pre>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => navigator.clipboard.writeText(`Portal BullsEye: ${loginUrl}\nUsuario: ${credentials.email}\nContraseña temporal: ${credentials.password}`)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-white border border-gray-200"
            >
              <IconCopy size={13} /> Copiar
            </button>
            <button onClick={() => setCredentials(null)} className="px-3 py-1.5 rounded-lg text-xs text-gray-500">Cerrar</button>
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500 border-b border-gray-100">
            <tr>
              {!clientId && <th className="p-3">Cliente</th>}
              <th className="p-3">Usuario</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Creado</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {users?.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-gray-400">Sin accesos todavía.</td></tr>
            )}
            {users?.map((u) => (
              <tr key={u.id} className="border-b border-gray-50 last:border-0">
                {!clientId && <td className="p-3">{u.client_name}</td>}
                <td className="p-3">
                  <div>{u.full_name ?? "—"}</div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </td>
                <td className="p-3">
                  <span className={`text-xs rounded px-2 py-0.5 ${u.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {u.is_active ? "Activo" : "Desactivado"}
                  </span>
                </td>
                <td className="p-3 text-xs text-gray-500">{new Date(u.created_at).toLocaleDateString("es-CL")}{u.created_by ? ` · ${u.created_by}` : ""}</td>
                <td className="p-3 text-right whitespace-nowrap text-xs space-x-3">
                  <button onClick={() => act(u, "reset_password")} className="text-[#251762] hover:underline">Nueva contraseña</button>
                  <button onClick={() => act(u, u.is_active ? "deactivate" : "activate")} className="text-gray-600 hover:underline">
                    {u.is_active ? "Desactivar" : "Activar"}
                  </button>
                  <button onClick={() => act(u, "delete")} className="text-red-600 hover:underline">Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

