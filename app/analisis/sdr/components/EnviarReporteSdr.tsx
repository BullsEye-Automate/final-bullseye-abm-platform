"use client";

// Botón "Enviar ahora" del Reporte SDR por correo: lo envía en el momento a
// los destinatarios configurados (POST /api/reporte-sdr). El corte se elige
// según la hora de Chile: antes de las 18:30 = 13:00, desde las 18:30 = 18:30.
import { useState } from "react";
import { IconLoader2, IconSend } from "@tabler/icons-react";

function currentCut(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  return h * 60 + m >= 18 * 60 + 30 ? "18:30" : "13:00";
}

export default function EnviarReporteSdr() {
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    const cut = currentCut();
    if (!window.confirm(`¿Enviar ahora el Reporte SDR (corte ${cut}) a los destinatarios de la lista?`)) return;
    setSending(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/reporte-sdr?corte=${encodeURIComponent(cut)}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se pudo enviar");
      setMsg(`Enviado a ${(json.sent?.to ?? json.recipients ?? []).join(", ")}`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={send}
        disabled={sending}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border hover:bg-black/5 transition disabled:opacity-50"
      >
        {sending ? <IconLoader2 size={15} className="animate-spin" /> : <IconSend size={15} />}
        Enviar ahora
      </button>
      {msg && <span className="text-xs text-ink-muted">{msg}</span>}
    </div>
  );
}
