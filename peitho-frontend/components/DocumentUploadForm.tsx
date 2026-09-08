"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KB_CATEGORIES, KB_CATEGORY_GROUPS } from "@/lib/knowledgeBaseCategories";
import { supabaseBrowser } from "@/lib/supabase/client";

function backendUrl(): string {
  return process.env.NEXT_PUBLIC_PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// `defaultCategory` precarga el <select> con la categoría seleccionada en el
// sidebar (Fase F) — si el usuario está viendo "Presentaciones" y sube un
// archivo, lo más probable es que quiera categorizarlo ahí mismo. Sigue
// siendo editable antes de subir.
export default function DocumentUploadForm({
  clientId,
  defaultCategory,
}: {
  clientId: string;
  defaultCategory?: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(defaultCategory ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      // Sube directo a peitho-backend (no vía proxy de Next.js) — Vercel
      // corta el body de una función serverless en 4.5MB en el plan Hobby,
      // y una presentación comercial real ya superó eso (confirmado: 4.7MB
      // rechazado). El backend en Railway no tiene ese límite (acepta hasta
      // 50MB, ver routes/clients.ts) — requiere CORS habilitado ahí para
      // este origen (PEITHO_FRONTEND_ORIGINS) y mandar el token de sesión
      // nosotros mismos, ya que no hay proxy server-side que lo agregue.
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();

      const formData = new FormData();
      formData.append("file", file);
      if (category) formData.append("category", category);
      const res = await fetch(`${backendUrl()}/clients/${clientId}/documents`, {
        method: "POST",
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo subir el archivo");
        return;
      }
      router.refresh();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        disabled={uploading}
        className="text-sm border border-gray-100 rounded-[9px] px-2.5 py-1.5 bg-white outline-none focus:border-[#62E0D8]"
      >
        <option value="">Sin categorizar</option>
        {KB_CATEGORY_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {KB_CATEGORIES.filter((c) => c.group === group).map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.odt,.odp,.ods,.rtf,.mp4,.mov,.webm,.png,.jpg,.jpeg,.gif,.svg"
        onChange={handleChange}
        disabled={uploading}
        className="text-sm block"
      />
      {uploading && <p className="text-xs text-gray-500 mt-1">Subiendo y procesando…</p>}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
