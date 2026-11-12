"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Pedido explícito del usuario (12-11-2026): algunos clientes no quieren que
// un bot visible se una a la videollamada — para esos, Peitho graba con la
// extensión de Chrome (chrome.tabCapture desde el navegador del ejecutivo,
// nadie nuevo se une a la llamada) en vez de agendar el bot de Recall.
// Decisión explícita del usuario: ambos mecanismos nunca conviven para un
// mismo cliente — al pasar a "extension" se cancelan los bots ya agendados
// para sus reuniones futuras (ver PUT /clients/:id/capture-mode).
export default function CaptureModeForm({
  clientId,
  initialMode,
}: {
  clientId: string;
  initialMode: "bot" | "extension";
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"bot" | "extension">(initialMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleChange(newMode: "bot" | "extension") {
    if (newMode === mode || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/capture-mode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capture_mode: newMode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar el modo de captura");
        return;
      }
      setMode(newMode);
      if (newMode === "extension" && data.bots_cancelados > 0) {
        setNotice(
          `Listo — se cancelaron ${data.bots_cancelados} bot${data.bots_cancelados === 1 ? "" : "s"} ya agendado${data.bots_cancelados === 1 ? "" : "s"} para reuniones futuras de este cliente.`
        );
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar con el backend");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-gray-500">Modo de captura de reuniones</p>
      <div className="flex gap-2">
        <button
          onClick={() => handleChange("bot")}
          disabled={saving}
          className="text-sm font-medium rounded-lg px-3.5 py-1.5 border disabled:opacity-50"
          style={
            mode === "bot"
              ? { background: "#251762", color: "#fff", borderColor: "#251762" }
              : { background: "#fff", color: "#374151", borderColor: "#E5E7EB" }
          }
        >
          Bot visible (Recall)
        </button>
        <button
          onClick={() => handleChange("extension")}
          disabled={saving}
          className="text-sm font-medium rounded-lg px-3.5 py-1.5 border disabled:opacity-50"
          style={
            mode === "extension"
              ? { background: "#251762", color: "#fff", borderColor: "#251762" }
              : { background: "#fff", color: "#374151", borderColor: "#E5E7EB" }
          }
        >
          Extensión invisible
        </button>
      </div>
      <p className="text-xs text-gray-400">
        "Bot visible" agenda un bot que se une a la videollamada como participante. "Extensión invisible" graba desde
        el navegador del ejecutivo (extensión de Chrome) sin que nadie nuevo se una a la llamada — requiere que el
        ejecutivo tenga la extensión instalada y haga clic para empezar a grabar cada reunión.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {notice && <p className="text-xs" style={{ color: "#1F8A5C" }}>{notice}</p>}
    </div>
  );
}
