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
  // Editar en vez de borrar+crear (pedido explícito del usuario, 30-09-2026:
  // un nombre mal cargado en Crossnet, "Santiago" en vez de "Sebastian
  // Cantor") — borrar perdía el vínculo con las reuniones ya asociadas a ese
  // ejecutivo, renombrar lo corrige en todas de una (ver comentario del
  // backend, PUT /clients/:id/executives/:executiveId).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

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

  function startEdit(exec: ClientExecutive) {
    setEditingId(exec.id);
    setEditingName(exec.name);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName("");
  }

  async function handleSaveEdit(executiveId: string) {
    if (!editingName.trim()) return;
    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/executives/${executiveId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo editar el ejecutivo");
        return;
      }
      cancelEdit();
      router.refresh();
    } finally {
      setSavingEdit(false);
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
          {executives.map((exec) =>
            editingId === exec.id ? (
              <li key={exec.id} className="py-2.5 flex items-center gap-2">
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  autoFocus
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2"
                  style={{ ["--tw-ring-color" as string]: "#62E0D8" }}
                />
                <button
                  onClick={() => handleSaveEdit(exec.id)}
                  disabled={savingEdit || !editingName.trim()}
                  className="text-xs font-medium disabled:opacity-50 shrink-0"
                  style={{ color: "#251762" }}
                >
                  {savingEdit ? "Guardando…" : "Guardar"}
                </button>
                <button onClick={cancelEdit} className="text-xs text-gray-500 shrink-0">
                  Cancelar
                </button>
              </li>
            ) : (
              <li key={exec.id} className="py-2.5 flex items-center justify-between gap-4">
                <p className="text-sm text-gray-900">{exec.name}</p>
                {canManage && (
                  <div className="flex items-center gap-3 shrink-0">
                    <button onClick={() => startEdit(exec)} className="text-xs hover:underline" style={{ color: "#251762" }}>
                      Editar
                    </button>
                    <button
                      onClick={() => handleDelete(exec.id)}
                      disabled={deletingId === exec.id}
                      className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                    >
                      {deletingId === exec.id ? "Borrando…" : "Borrar"}
                    </button>
                  </div>
                )}
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
