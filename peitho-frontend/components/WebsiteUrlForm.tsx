"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Pedido explícito del usuario (10-09-2026): guardar la URL del sitio del
// cliente y traer su contenido a la base de conocimiento (el backend hace
// el fetch con la tool web_fetch de Claude, ver fetchAndStoreWebsiteContent
// en knowledgeBase.ts) — se usa automático en research y análisis, sin
// tocar esos prompts.
export default function WebsiteUrlForm({
  clientId,
  initialUrl,
}: {
  clientId: string;
  initialUrl: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/website`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website_url: value.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar la URL");
        return;
      }
      if (value.trim() && data.fetched === false) {
        setNotice(`Se guardó la URL, pero no se pudo traer el contenido del sitio todavía: ${data.fetch_error ?? "error desconocido"}. Podés reintentar guardando de nuevo.`);
      } else if (value.trim() && data.fetched) {
        setNotice("Contenido del sitio agregado a la base de conocimiento.");
      }
      router.refresh();
    } catch {
      setError("No se pudo guardar la URL");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-gray-500">Sitio web del cliente</p>
      <div className="flex items-center gap-2">
        <input
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://www.ejemplo.com"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white outline-none focus:border-[#62E0D8]"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-sm font-medium text-white rounded-lg px-3.5 py-1.5 disabled:opacity-50"
          style={{ background: "#251762" }}
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
      <p className="text-xs text-gray-400">
        Al guardarla, Peitho trae el contenido del sitio (a qué se dedica, ICP, diferenciadores) y lo suma a la base
        de conocimiento — se usa igual que un documento subido a mano.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {notice && <p className="text-xs text-gray-500">{notice}</p>}
    </div>
  );
}
