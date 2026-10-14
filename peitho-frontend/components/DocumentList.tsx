"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { KnowledgeBaseDocument } from "@/lib/peithoBackend";
import { kbCategoryLabel } from "@/lib/knowledgeBaseCategories";

// timeZone explícito — ver el mismo fix en MeetingsTable.tsx (sin esto,
// toLocaleString usa la zona del servidor, no la de Chile).
function formatDate(value: string): string {
  return new Date(value).toLocaleString("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Santiago",
  });
}

export default function DocumentList({
  clientId,
  documents,
  canDelete = false,
  showCategory = false,
}: {
  clientId: string;
  documents: KnowledgeBaseDocument[];
  canDelete?: boolean;
  // Fase F — solo tiene sentido en la vista "Todo el material" (mezcla
  // categorías); dentro de una categoría ya seleccionada es redundante.
  showCategory?: boolean;
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadErrorId, setDownloadErrorId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function handleDelete(documentId: string) {
    setDeletingId(documentId);
    try {
      await fetch(`/api/clients/${clientId}/documents/${documentId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  // Pedido explícito del usuario (14-10-2026): poder descargar los documentos
  // ya subidos para revisarlos — el bucket de Supabase Storage es privado,
  // así que no hay una URL fija para linkear directo; se pide una firmada de
  // corta duración (5 min, ver getKnowledgeBaseDocumentDownloadUrl en el
  // backend) justo al hacer clic y se abre de inmediato.
  async function handleDownload(documentId: string) {
    setDownloadingId(documentId);
    setDownloadErrorId(null);
    setDownloadError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/documents/${documentId}/download`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setDownloadErrorId(documentId);
        setDownloadError(data.error ?? "No se pudo generar el link de descarga");
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloadingId(null);
    }
  }

  if (documents.length === 0) {
    return <p className="text-sm text-gray-500">Todavía no hay documentos subidos para este cliente.</p>;
  }

  return (
    <ul className="divide-y divide-gray-50">
      {documents.map((doc) => (
        <li key={doc.id} className="py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900">{doc.file_name}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {showCategory && <span>{kbCategoryLabel(doc.category)} · </span>}
              {formatDate(doc.uploaded_at)}
              {!doc.content_extracted && (
                <span className="text-amber-600"> · no se pudo extraer el texto de este archivo</span>
              )}
              {downloadErrorId === doc.id && downloadError && (
                <span className="text-red-600"> · {downloadError}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => handleDownload(doc.id)}
              disabled={downloadingId === doc.id}
              className="text-xs hover:underline disabled:opacity-50"
              style={{ color: "#251762" }}
            >
              {downloadingId === doc.id ? "Generando link…" : "Descargar"}
            </button>
            {canDelete && (
              <button
                onClick={() => handleDelete(doc.id)}
                disabled={deletingId === doc.id}
                className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
              >
                {deletingId === doc.id ? "Borrando…" : "Borrar"}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
