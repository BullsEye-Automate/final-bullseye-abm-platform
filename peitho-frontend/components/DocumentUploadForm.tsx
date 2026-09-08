"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KB_CATEGORIES, KB_CATEGORY_GROUPS } from "@/lib/knowledgeBaseCategories";

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
      const formData = new FormData();
      formData.append("file", file);
      if (category) formData.append("category", category);
      const res = await fetch(`/api/clients/${clientId}/documents`, {
        method: "POST",
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
