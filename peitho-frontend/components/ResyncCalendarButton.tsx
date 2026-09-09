"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Solo se muestra (ver reuniones/[id]/page.tsx) para reuniones de invitación
// manual al bot (is_bot_invite) — admin-only. Cubre el caso real de
// contraparte/empresa_contraparte que quedaron mal calculados por un bug ya
// corregido en el código (ver CLAUDE.md, 09-09-2026: CCHC/Paula Rios) y que
// arreglar el código no corrige solo — hay que volver a pedirle el evento a
// Google Calendar y recalcular con la lógica actual.
export default function ResyncCalendarButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/resync-calendar`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo re-sincronizar");
        return;
      }
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={syncing}
        className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 transition disabled:opacity-50"
      >
        {syncing ? "Sincronizando…" : "Re-sincronizar desde Calendar"}
      </button>
      {error && <p className="text-xs text-red-600 max-w-xs text-right">{error}</p>}
    </div>
  );
}
