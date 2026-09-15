"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Pedido explícito del usuario (15-09-2026), tras un bug real (SeguriMaxima/
// Felipe Salgado): el bot agotó sus reintentos automáticos sin lograr
// entrar (Google rechazó el join 3 veces seguidas con sso_not_configured,
// un rechazo intermitente ya conocido — ver checkAndRetryFailedRecallBots
// en recall.ts). Antes la única forma de salvar una reunión así era un curl
// manual directo a la API de Recall — este botón hace lo mismo desde la app,
// cancelando el bot viejo (si existía) y creando uno nuevo con join
// inmediato.
export default function RetryBotButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function handleClick() {
    setRetrying(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/retry-bot`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: data.error ?? "No se pudo reintentar el bot", error: true });
        return;
      }
      setMessage({ text: "Bot reintentado — debería entrar en unos segundos.", error: false });
      router.refresh();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={retrying}
        className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 transition disabled:opacity-50"
      >
        {retrying ? "Reintentando…" : "Reintentar bot ahora"}
      </button>
      {message && (
        <p className={`text-xs max-w-xs text-right ${message.error ? "text-red-600" : "text-gray-500"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
