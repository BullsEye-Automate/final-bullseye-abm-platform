"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { KnowledgeBaseDocument } from "@/lib/peithoBackend";

function formatDate(value: string): string {
  return new Date(value).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" });
}

export default function DocumentList({
  clientId,
  documents,
  readOnly = false,
}: {
  clientId: string;
  documents: KnowledgeBaseDocument[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(documentId: string) {
    setDeletingId(documentId);
    try {
      await fetch(`/api/clients/${clientId}/documents/${documentId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setDeletingId(null);
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
              {formatDate(doc.uploaded_at)}
              {!doc.content_extracted && (
                <span className="text-amber-600"> · no se pudo extraer el texto de este archivo</span>
              )}
            </p>
          </div>
          {!readOnly && (
            <button
              onClick={() => handleDelete(doc.id)}
              disabled={deletingId === doc.id}
              className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 shrink-0"
            >
              {deletingId === doc.id ? "Borrando…" : "Borrar"}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
