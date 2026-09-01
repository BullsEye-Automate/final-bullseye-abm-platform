"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRoleItem } from "@/lib/peithoBackend";

export default function UserRolesList({ roles }: { roles: UserRoleItem[] }) {
  const router = useRouter();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  async function handleRevoke(userId: string) {
    setRevokingId(userId);
    try {
      await fetch(`/api/admin/user-roles/${userId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setRevokingId(null);
    }
  }

  if (roles.length === 0) {
    return <p className="text-sm text-gray-500">Todavía no hay usuarios con acceso asignado.</p>;
  }

  // Filtro simple en el propio navegador — la lista de roles ya viene completa
  // del backend, no hace falta ida y vuelta al servidor para filtrarla.
  const clientNames = Array.from(
    new Set(roles.filter((r) => r.role === "client" && r.client_name).map((r) => r.client_name as string))
  ).sort((a, b) => a.localeCompare(b));

  const filteredRoles = roles.filter((role) => {
    if (!filter) return true;
    if (filter === "__admin__") return role.role === "admin";
    return role.client_name === filter;
  });

  return (
    <div className="space-y-3">
      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
      >
        <option value="">Todos los clientes</option>
        <option value="__admin__">Solo admins</option>
        {clientNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      {filteredRoles.length === 0 ? (
        <p className="text-sm text-gray-500">Ningún usuario coincide con este filtro.</p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {filteredRoles.map((role) => (
            <li key={role.user_id} className="py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">{role.email}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {role.role === "admin" ? "Admin" : `Cliente · ${role.client_name ?? "sin cliente"}`}
                </p>
              </div>
              <button
                onClick={() => handleRevoke(role.user_id)}
                disabled={revokingId === role.user_id}
                className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 shrink-0"
              >
                {revokingId === role.user_id ? "Revocando…" : "Revocar acceso"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
