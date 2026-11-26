"use client";

import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconPhotoPlus, IconRefresh, IconTrash } from "@tabler/icons-react";

// Pantallazos de una reunión (lib/meetingShots.ts). Dos modos:
//  - token: el cliente, en /encuesta/<token> y en el formulario de feedback
//    (público, por el feedback_token de la reunión). Sube y ve.
//  - team: el equipo, en Pulso ABM → Detalle de reuniones. Sube, ve, borra y
//    vuelve a leer con IA.
// La IA lee cada pantallazo al subirlo y deja un resumen de lo que dice el
// cliente; eso se suma al feedback de la reunión.

type Shot = {
  id: string; name: string; at: string; by: string; source: "cliente" | "equipo"; url?: string;
  ai?: { status: "ok" | "error"; resumen?: string; comentarios?: string[]; sentimiento?: string; error?: string };
};
type Mode = { kind: "token"; token: string } | { kind: "team"; meetingId: string };

const MAX_SIDE = 2000;

// Achica la imagen en el navegador (Vercel acepta hasta 4,5 MB por request).
// Los GIF se suben tal cual.
async function shrink(file: File): Promise<Blob> {
  if (file.type === "image/gif" || file.size < 900_000) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  return blob ?? file;
}

export default function MeetingShots({ mode, compact = false, onChange }: { mode: Mode; compact?: boolean; onChange?: (n: number) => void }) {
  const [shots, setShots] = useState<Shot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const team = mode.kind === "team";
  const base = team ? "/api/radar-abm/pantallazos" : `/api/encuesta/${mode.token}/pantallazos`;
  const listUrl = team ? `${base}?meeting_id=${encodeURIComponent(mode.meetingId)}` : base;

  useEffect(() => {
    setShots(null); setError(null);
    fetch(listUrl, { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudieron cargar los pantallazos");
      setShots(j.shots ?? []);
    }).catch((e) => { setError(e.message); setShots([]); });
  }, [listUrl]);

  function update(next: Shot[]) { setShots(next); onChange?.(next.length); }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    let current = shots ?? [];
    for (const [i, f] of Array.from(files).entries()) {
      if (!f.type.startsWith("image/")) { setError(`${f.name}: solo imágenes.`); continue; }
      setBusy(`Subiendo y leyendo ${files.length > 1 ? `${i + 1} de ${files.length}` : "el pantallazo"}…`);
      try {
        const fd = new FormData();
        const blob = await shrink(f);
        fd.append("file", blob, blob === f ? f.name : f.name.replace(/\.[^.]+$/, "") + ".jpg");
        if (team) fd.append("meeting_id", mode.meetingId);
        const r = await fetch(base, { method: "POST", body: fd });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "No se pudo subir");
        current = [...current, j.shot];
        update(current);
      } catch (e) { setError(`${f.name}: ${(e as Error).message}`); }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
  }

  async function remove(s: Shot) {
    if (!team || !confirm("¿Borrar este pantallazo?")) return;
    setBusy("Borrando…");
    try {
      const r = await fetch(`${base}?meeting_id=${encodeURIComponent(mode.meetingId)}&id=${s.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "No se pudo borrar");
      update((shots ?? []).filter((x) => x.id !== s.id));
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function reread(s: Shot) {
    if (!team) return;
    setBusy("Leyendo con IA…");
    try {
      const r = await fetch(base, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meeting_id: mode.meetingId, id: s.id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo leer");
      update((shots ?? []).map((x) => (x.id === s.id ? j.shot : x)));
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-2">
      {!compact && (
        <p className="text-xs text-gray-500">
          {team
            ? "Sube los pantallazos que el cliente comparte por WhatsApp o correo sobre esta reunión. La IA los lee y suma sus comentarios al feedback."
            : "¿Tienes capturas con comentarios de la reunión (WhatsApp, correo, notas)? Súbelas aquí: las leemos y las sumamos a tu feedback."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => input.current?.click()} disabled={!!busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {busy ? <IconLoader2 size={15} className="animate-spin" /> : <IconPhotoPlus size={15} />} {busy ?? "Adjuntar pantallazos"}
        </button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => upload(e.target.files)} />
        {shots && shots.length > 0 && <span className="text-xs text-gray-500">{shots.length} {shots.length === 1 ? "pantallazo" : "pantallazos"}</span>}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {shots === null ? (
        <p className="text-xs text-gray-400"><IconLoader2 size={12} className="inline animate-spin" /> Cargando…</p>
      ) : shots.length > 0 && (
        <ul className="space-y-2">
          {shots.map((s) => (
            <li key={s.id} className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 p-2">
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt={s.name} className="h-20 w-16 rounded object-cover border border-gray-200" />
                </a>
              ) : <div className="h-20 w-16 shrink-0 rounded bg-gray-200" />}
              <div className="min-w-0 flex-1 text-xs text-gray-600">
                <p className="text-gray-400">
                  {new Date(s.at).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })} · {s.source === "cliente" ? "subido por el cliente" : `subido por ${s.by}`}
                </p>
                {s.ai?.status === "ok" ? (
                  <>
                    <p className="mt-0.5 text-gray-800">{s.ai.resumen}</p>
                    {team && (s.ai.comentarios?.length ?? 0) > 0 && (
                      <ul className="mt-1 list-disc pl-4">{s.ai.comentarios!.map((c, i) => <li key={i}>«{c}»</li>)}</ul>
                    )}
                  </>
                ) : (
                  <p className="mt-0.5 text-amber-700">{team ? `No se pudo leer con IA${s.ai?.error ? `: ${s.ai.error}` : ""}.` : "Recibido."}</p>
                )}
                {team && (
                  <div className="mt-1 flex gap-3">
                    {s.ai?.status !== "ok" && <button type="button" className="inline-flex items-center gap-1 text-teal-700 hover:underline" onClick={() => reread(s)} disabled={!!busy}><IconRefresh size={12} /> Volver a leer</button>}
                    <button type="button" className="inline-flex items-center gap-1 text-red-600 hover:underline" onClick={() => remove(s)} disabled={!!busy}><IconTrash size={12} /> Borrar</button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
