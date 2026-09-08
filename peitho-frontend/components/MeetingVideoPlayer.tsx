"use client";

import { useState } from "react";

// Pide la URL firmada recién al hacer clic (no en la carga de la página) —
// el link solo dura 10 minutos del lado del backend, así que no tiene
// sentido pedirlo antes de que alguien realmente quiera ver el video.
export default function MeetingVideoPlayer({ meetingId }: { meetingId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/video`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo cargar el video");
        return;
      }
      setUrl(data.url);
    } finally {
      setLoading(false);
    }
  }

  if (url) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <video controls src={url} className="w-full rounded-xl bg-black" />;
  }

  return (
    <div>
      <button
        onClick={handleLoad}
        disabled={loading}
        className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
        style={{ background: "#251762" }}
      >
        {loading ? "Cargando video…" : "Ver video de la reunión"}
      </button>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
