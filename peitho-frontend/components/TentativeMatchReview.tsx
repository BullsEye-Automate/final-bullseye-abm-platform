"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Candidate {
  idReunion: string;
  cliente: string;
  empresa: string;
  contacto: string;
  cargo: string;
  industria: string;
  fechaReunion: string;
}

// Pedido explícito del usuario (15-09-2026), tras un bug real
// (SeguriMaxima/Interex): cuando el excel de metas tiene 2+ reuniones
// agendadas para la misma fecha/hora y no hay forma de saber cuál
// corresponde sin adivinar (ver matchMeetingRow en metasSheet.ts), Peitho ya
// no elige a ciegas — deja la reunión como "tentative" con los candidatos
// guardados, y este componente le muestra al admin cada opción para que
// apruebe la correcta o las rechace todas.
export default function TentativeMatchReview({
  meetingId,
  candidates,
}: {
  meetingId: string;
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(idReunion: string | null) {
    setSaving(idReunion ?? "reject");
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/resolve-tentative-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_reunion: idReunion }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo guardar");
        return;
      }
      router.refresh();
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "#62E0D8", background: "#62E0D822" }}>
      <p className="text-sm font-semibold" style={{ color: "#251762" }}>
        Match pendiente de revisión
      </p>
      <p className="text-xs text-gray-600">
        Hay {candidates.length} reuniones en el excel de metas agendadas para la misma fecha y no se puede elegir cuál
        corresponde sin adivinar. Elegí la correcta, o rechazalas si ninguna aplica.
      </p>
      <div className="space-y-2">
        {candidates.map((c) => (
          <div
            key={c.idReunion}
            className="flex items-center justify-between gap-3 bg-white rounded-lg border border-gray-200 px-3 py-2"
          >
            <div className="text-sm">
              <p className="font-medium text-gray-800">
                {c.contacto || "—"} · {c.empresa || "—"}
              </p>
              <p className="text-xs text-gray-500">
                Cliente: {c.cliente || "—"} · Cargo: {c.cargo || "—"} · Industria: {c.industria || "—"} · Fecha:{" "}
                {c.fechaReunion || "—"}
              </p>
            </div>
            <button
              onClick={() => resolve(c.idReunion)}
              disabled={saving !== null}
              className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "#251762" }}
            >
              {saving === c.idReunion ? "Guardando…" : "Usar este"}
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => resolve(null)}
        disabled={saving !== null}
        className="text-xs font-medium text-gray-500 underline disabled:opacity-50"
      >
        {saving === "reject" ? "Guardando…" : "Ninguno de estos — dejar sin match"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
