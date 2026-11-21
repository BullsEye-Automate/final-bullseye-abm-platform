"use client";

import { useCallback, useEffect, useState } from "react";

// Usuarios de Peitho del cliente (los que entran a app.peithob2b.com). Solo el
// equipo de BullsEye los gestiona, desde la app interna: /integration/users del
// backend de Peitho vía el proxy /api/clients/<id>/peitho/proxy. Sin correo de
// invitación (el link de Supabase llegaba vencido): Peitho crea la cuenta con
// una contraseña temporal que se muestra UNA vez acá para entregarla al
// cliente; "Nueva contraseña" genera otra si la pierde.

type PeithoUser = { user_id: string; email: string; client_sub_role: "admin" | "user" | null; client_name: string | null; created_at?: string };

const SUB_ROLE_LABEL = {
  admin: "Administrador (todo: panel, reuniones, base de conocimiento)",
  user: "Usuario (solo reuniones)",
};

export default function PeithoUsersManager({ base }: { base: string }) {
  const [users, setUsers] = useState<PeithoUser[] | null>(null);
  const [peithoClient, setPeithoClient] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [subRole, setSubRole] = useState<"admin" | "user">("admin");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Credenciales recién generadas: se muestran una sola vez
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [u, c] = await Promise.all([
      fetch(`${base}/integration/users`, { cache: "no-store" }),
      fetch(`${base}/integration/client`, { cache: "no-store" }),
    ]);
    const uj = await u.json().catch(() => null);
    const cj = await c.json().catch(() => null);
    if (!u.ok) {
      setUsers([]);
      setError(uj?.error ?? "No pudimos leer los usuarios de Peitho");
      return;
    }
    setUsers(uj ?? []);
    setPeithoClient(c.ok ? cj?.name ?? null : null);
  }, [base]);

  useEffect(() => {
    setUsers(null);
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setCreds(null);
    const r = await fetch(`${base}/integration/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, clientSubRole: subRole }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: j.error ?? "No se pudo crear el usuario" });
    if (j.password) setCreds({ email: j.email ?? email, password: j.password });
    else setMsg({ ok: true, text: `${email} ya tenía acceso: se actualizaron sus permisos (su contraseña no cambia). Usa "Nueva contraseña" si la perdió.` });
    setEmail("");
    load();
  }

  async function newPassword(u: PeithoUser) {
    if (!confirm(`¿Generar una contraseña nueva para ${u.email}? La actual deja de funcionar.`)) return;
    setMsg(null);
    setCreds(null);
    const r = await fetch(`${base}/integration/users/${u.user_id}/password`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.password) return setMsg({ ok: false, text: j.error ?? "No se pudo generar la contraseña" });
    setCreds({ email: u.email, password: j.password });
  }

  async function remove(u: PeithoUser) {
    if (!confirm(`¿Quitar el acceso a Peitho de ${u.email}?`)) return;
    const r = await fetch(`${base}/integration/users/${u.user_id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg({ ok: false, text: j.error ?? "No se pudo quitar el acceso" });
    load();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Personas del cliente que entran a Peitho (app.peithob2b.com). Al crear un usuario se genera una contraseña temporal para entregársela (no se envía ningún correo).{" "}
        {peithoClient && <span>Cliente en Peitho: <b>{peithoClient}</b>.</span>}
      </p>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="persona@cliente.com"
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-64"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">Permisos</span>
          <select value={subRole} onChange={(e) => setSubRole(e.target.value as "admin" | "user")} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="admin">{SUB_ROLE_LABEL.admin}</option>
            <option value="user">{SUB_ROLE_LABEL.user}</option>
          </select>
        </label>
        <button disabled={busy} className="px-4 py-1.5 rounded-lg text-sm text-white disabled:opacity-50" style={{ background: "#251762" }}>
          {busy ? "Creando…" : "Crear usuario"}
        </button>
      </form>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</p>}
      {creds && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm space-y-2">
          <p className="font-medium text-amber-900">Copia estos datos ahora: la contraseña no se vuelve a mostrar.</p>
          <div className="font-mono text-xs bg-white rounded-lg border border-amber-100 p-3 space-y-1">
            <div>Portal: https://app.peithob2b.com</div>
            <div>Usuario: {creds.email}</div>
            <div>Contraseña temporal: {creds.password}</div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(`Portal: https://app.peithob2b.com\nUsuario: ${creds.email}\nContraseña temporal: ${creds.password}\n\nAl entrar, cámbiala en "Cambiar contraseña".`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="px-3 py-1.5 rounded-lg text-xs text-white"
              style={{ background: "#251762" }}
            >
              {copied ? "Copiado" : "Copiar para enviar"}
            </button>
            <span className="text-xs text-amber-800">Envíaselos por WhatsApp o correo. Al entrar puede cambiarla en &quot;Cambiar contraseña&quot;.</span>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {users === null ? (
        <p className="text-sm text-gray-400">Cargando usuarios…</p>
      ) : users.length === 0 ? (
        !error && <p className="text-sm text-gray-400">Este cliente todavía no tiene usuarios en Peitho.</p>
      ) : (
        <div className="border border-gray-100 rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500 bg-gray-50">
              <tr><th className="p-2.5">Email</th><th className="p-2.5">Permisos</th><th className="p-2.5"></th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="border-t border-gray-50">
                  <td className="p-2.5">{u.email}{u.client_name && peithoClient && u.client_name !== peithoClient ? <span className="text-xs text-gray-400"> · {u.client_name}</span> : null}</td>
                  <td className="p-2.5 text-gray-500">{u.client_sub_role === "user" ? "Usuario" : "Administrador"}</td>
                  <td className="p-2.5 text-right whitespace-nowrap">
                    <button onClick={() => newPassword(u)} className="text-xs text-[#251762] hover:underline mr-4">Nueva contraseña</button>
                    <button onClick={() => remove(u)} className="text-xs text-red-600 hover:underline">Quitar acceso</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
