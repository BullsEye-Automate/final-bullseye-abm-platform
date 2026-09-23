"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientExecutive } from "@/lib/peithoBackend";

// Roster de ejecutivos por cliente (23-09-2026, pedido explícito del
// usuario) — reemplaza la dependencia de la columna "Sales Manager" del
// excel de metas (texto libre, casi siempre vacía) como única fuente de
// "quién de este cliente tomó la reunión". Cada reunión se vincula acá
// automático por texto (ver matchClientExecutiveName en el backend) o se
// corrige a mano desde el detalle de la reunión (MeetingExecutiveSelect,
// abierto a cualquier usuario "client" de esta empresa, no solo admin).
//
// canManage: admin de BullsEye o "admin cliente" de esta empresa — decisión
// explícita del usuario de dejar que el propio cliente gestione su equipo.
export default function ClientExecutivesManager({
  clientId,
  executives,
  canManage,
}: {
  clientId: string;
  executives: ClientExecutive[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/executives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo agregar el ejecutivo");
        return;
      }
      setName("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(executiveId: string) {
    setDeletingId(executiveId);
    try {
      await fetch(`/api/clients/${clientId}/executives/${executiveId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Ejecutivos</h2>
        <p className="text-xs text-gray-500 mt-1">
          Equipo de este cliente que toma reuniones — cada reunión se vincula automático cuando el excel de metas
          trae un nombre que calza, o se corrige a mano desde el detalle de la reunión.
        </p>
      </div>

      {canManage && (
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del ejecutivo"
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
            style={{ ["--tw-ring-color" as string]: "#62E0D8" }}
          />
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 shrink-0"
            style={{ background: "#251762" }}
          >
            {saving ? "Agregando…" : "Agregar"}
          </button>
        </form>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {executives.length === 0 ? (
        <p className="text-sm text-gray-500">Todavía no hay ejecutivos cargados para este cliente.</p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {executives.map((exec) => (
            <li key={exec.id} className="py-2.5 flex items-center justify-between gap-4">
              <p className="text-sm text-gray-900">{exec.name}</p>
              {canManage && (
                <button
                  onClick={() => handleDelete(exec.id)}
                  disabled={deletingId === exec.id}
                  className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 shrink-0"
                >
                  {deletingId === exec.id ? "Borrando…" : "Borrar"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
