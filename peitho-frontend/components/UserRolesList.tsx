"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRoleItem } from "@/lib/peithoBackend";

export default function UserRolesList({ roles }: { roles: UserRoleItem[] }) {
  const router = useRouter();
  const [revokingId, setRevokingId] = useState<string | null>(null);

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

  return (
    <ul className="divide-y divide-gray-50">
      {roles.map((role) => (
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
  );
}
