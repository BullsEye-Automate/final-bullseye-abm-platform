"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ClientListItem, UserRoleItem } from "@/lib/peithoBackend";

export default function AssignRoleForm({
  clients,
  editingUser,
  onDoneEditing,
}: {
  clients: ClientListItem[];
  editingUser: UserRoleItem | null;
  onDoneEditing: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "client">("client");
  const [clientId, setClientId] = useState("");
  const [clientSubRole, setClientSubRole] = useState<"admin" | "user">("admin");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  // Al hacer clic en "Editar rol" en la lista de abajo, UserManagement pasa
  // la fila elegida acá — el mismo formulario sirve para editar (el backend
  // hace upsert por email, no hace falta un endpoint separado).
  useEffect(() => {
    if (!editingUser) return;
    setEmail(editingUser.email);
    setRole(editingUser.role);
    setClientId(editingUser.client_id ?? "");
    setClientSubRole(editingUser.client_sub_role === "user" ? "user" : "admin");
    setError(null);
    setInvitedEmail(null);
    setResendError(null);
  }, [editingUser]);

  function resetForm() {
    setEmail("");
    setRole("client");
    setClientId("");
    setClientSubRole("admin");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || (role === "client" && !clientId)) return;

    setSaving(true);
    setError(null);
    setInvitedEmail(null);
    setResendError(null);
    try {
      const res = await fetch("/api/admin/user-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          role,
          clientId: role === "client" ? clientId : null,
          clientSubRole: role === "client" ? clientSubRole : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo asignar el rol");
        return;
      }
      if (data.invited) setInvitedEmail(email.trim());
      if (data.resendError) setResendError(email.trim());
      resetForm();
      onDoneEditing();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    resetForm();
    setError(null);
    setInvitedEmail(null);
    setResendError(null);
    onDoneEditing();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-start">
      {editingUser && (
        <p className="text-xs text-gray-500 w-full">
          Editando el rol de <span className="font-medium text-gray-700">{editingUser.email}</span> —{" "}
          <button type="button" onClick={handleCancel} className="underline hover:text-gray-700">
            cancelar
          </button>
        </p>
      )}
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        readOnly={!!editingUser}
        placeholder="email@ejemplo.com"
        className={`flex-1 min-w-[200px] text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 ${
          editingUser ? "bg-gray-50 text-gray-500" : ""
        }`}
        style={{ ["--tw-ring-color" as string]: "#62E0D8" }}
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as "admin" | "client")}
        className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
      >
        <option value="client">Cliente</option>
        <option value="admin">Admin</option>
      </select>
      {role === "client" && (
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">Selecciona un cliente…</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      )}
      {role === "client" && (
        <select
          value={clientSubRole}
          onChange={(e) => setClientSubRole(e.target.value as "admin" | "user")}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
          title="Admin cliente ve todo (panel, base de conocimiento y reuniones). Usuario cliente solo ve reuniones."
        >
          <option value="admin">Admin cliente (ve todo)</option>
          <option value="user">Usuario cliente (solo reuniones)</option>
        </select>
      )}
      <button
        type="submit"
        disabled={saving || !email.trim() || (role === "client" && !clientId)}
        className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
        style={{ background: "#251762" }}
      >
        {saving ? "Guardando…" : editingUser ? "Guardar cambios" : "Asignar acceso"}
      </button>
      {error && <p className="text-xs text-red-600 w-full">{error}</p>}
      {invitedEmail && (
        <p className="text-xs text-green-600 w-full">
          Le llegó un correo de invitación a {invitedEmail} para que elija su contraseña.
        </p>
      )}
      {resendError && (
        <p className="text-xs text-amber-600 w-full">
          El rol quedó asignado, pero no se pudo reenviar el correo de invitación a {resendError} — reenvíalo a
          mano desde Supabase Studio → Authentication → Users.
        </p>
      )}
      {role === "client" && (
        <p className="text-xs text-gray-400 w-full">
          ¿El cliente no aparece en la lista?{" "}
          <Link href="/base-de-conocimiento" className="underline hover:text-gray-600">
            Créalo en Base de conocimiento
          </Link>{" "}
          y vuelve a esta pantalla.
        </p>
      )}
    </form>
  );
}
