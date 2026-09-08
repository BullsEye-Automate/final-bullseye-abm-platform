"use client";

import { useMemo, useState } from "react";
import type { KnowledgeBaseDocument } from "@/lib/peithoBackend";
import { KB_CATEGORIES, KB_CATEGORY_GROUPS } from "@/lib/knowledgeBaseCategories";
import DocumentList from "@/components/DocumentList";
import DocumentUploadForm from "@/components/DocumentUploadForm";

// Fase F — sidebar de categorías sobre la Base de conocimiento de un
// cliente. Igual que ReunionesFuturasView/ReunionesPasadasView, filtra en el
// navegador sobre los documentos que ya trajo el Server Component (sin
// endpoint nuevo): `selected=null` es "Todo el material" (sin filtrar).
export default function KnowledgeBaseView({
  clientId,
  documents,
  readOnly,
}: {
  clientId: string;
  documents: KnowledgeBaseDocument[];
  readOnly: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const doc of documents) {
      const key = doc.category ?? "sin_categoria";
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [documents]);

  const filtered = selected == null ? documents : documents.filter((d) => d.category === selected);

  function CategoryButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
    return (
      <button
        onClick={onClick}
        className="w-full flex items-center justify-between gap-2 pl-3 pr-2.5 py-2 rounded-[9px] text-[13.5px] transition text-left"
        style={active ? { background: "#EFECFA", color: "#251762", fontWeight: 600 } : { color: "#635C79" }}
      >
        <span>{label}</span>
        <span
          className="text-[11px] px-1.5 py-0.5 rounded-full shrink-0"
          style={active ? { background: "#DFDAF5", color: "#251762" } : { background: "#F3F2F8", color: "#948DA8" }}
        >
          {count}
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-start gap-6">
      <aside className="w-[220px] shrink-0 space-y-4">
        <CategoryButton label="Todo el material" count={documents.length} active={selected === null} onClick={() => setSelected(null)} />
        {KB_CATEGORY_GROUPS.map((group) => (
          <div key={group}>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#948DA8] px-3 pb-1">{group}</p>
            <div className="flex flex-col gap-0.5">
              {KB_CATEGORIES.filter((c) => c.group === group).map((c) => (
                <CategoryButton
                  key={c.key}
                  label={c.label}
                  count={counts[c.key] ?? 0}
                  active={selected === c.key}
                  onClick={() => setSelected(c.key)}
                />
              ))}
            </div>
          </div>
        ))}
      </aside>

      <div className="flex-1 min-w-0 space-y-6">
        {!readOnly && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Subir documento</h2>
            <p className="text-xs text-gray-500">
              Formatos soportados: PDF, Word, PowerPoint, Excel, texto plano, OpenDocument, RTF, video e imagen.
              Máximo 50MB por archivo (límite del plan actual de Supabase Storage).
            </p>
            <DocumentUploadForm clientId={clientId} defaultCategory={selected} />
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">
            {selected === null ? "Todo el material" : KB_CATEGORIES.find((c) => c.key === selected)?.label} ({filtered.length})
          </h2>
          <DocumentList clientId={clientId} documents={filtered} readOnly={readOnly} showCategory={selected === null} />
        </div>
      </div>
    </div>
  );
}
