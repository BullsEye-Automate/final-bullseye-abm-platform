"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Borrado manual admin-only — pedido explícito del usuario para poder
// limpiar reuniones creadas por error (ej. un evento de prueba, un
// duplicado). Confirmación nativa (window.confirm) alcanza para una
// herramienta interna de uso admin, no hace falta un modal propio.
export default function DeleteMeetingButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm("¿Borrar esta reunión? No se puede deshacer.")) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo borrar");
        setDeleting(false);
        return;
      }
      router.push("/reuniones/futuras");
      router.refresh();
    } catch {
      setError("No se pudo borrar");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="text-xs font-medium text-red-600 border border-red-200 rounded-lg px-3 py-2 bg-white hover:bg-red-50 disabled:opacity-50"
      >
        {deleting ? "Borrando..." : "Borrar reunión"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
