"use client";

import { useState } from "react";
import type { ClientListItem, UserRoleItem } from "@/lib/peithoBackend";
import AssignRoleForm from "./AssignRoleForm";
import UserRolesList from "./UserRolesList";

// Envuelve AssignRoleForm + UserRolesList para que "Editar rol" en la lista
// de abajo precargue el formulario de arriba (23-09-2026, pedido explícito
// del usuario — antes solo se podía revocar y volver a crear desde cero).
// El backend ya hace upsert por email en POST /admin/user-roles, así que no
// hizo falta ningún endpoint nuevo — solo compartir este estado entre los
// dos componentes, que antes eran hermanos sin comunicación.
export default function UserManagement({
  clients,
  roles,
}: {
  clients: ClientListItem[];
  roles: UserRoleItem[];
}) {
  const [editingUser, setEditingUser] = useState<UserRoleItem | null>(null);

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Asignar rol</h2>
        <AssignRoleForm clients={clients} editingUser={editingUser} onDoneEditing={() => setEditingUser(null)} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Usuarios con acceso ({roles.length})</h2>
        <UserRolesList roles={roles} onEdit={setEditingUser} />
      </div>
    </>
  );
}
