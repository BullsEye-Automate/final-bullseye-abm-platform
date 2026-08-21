import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchClients, fetchClientDocuments, fetchMe } from "@/lib/peithoBackend";
import DocumentUploadForm from "@/components/DocumentUploadForm";
import DocumentList from "@/components/DocumentList";

// Un usuario "client" puede VER (no subir/borrar) la base de conocimiento de
// su propio cliente — aclaración explícita del usuario en la Fase E. El
// backend ya rechaza esto para otro client_id (404); acá se corta antes para
// no depender de que fetchClients() (admin-only) no reviente para ese rol.
export default async function ClientKnowledgeBasePage({ params }: { params: { id: string } }) {
  const me = await fetchMe();
  const isAdmin = me?.role === "admin";

  if (!isAdmin && me?.clientId !== params.id) notFound();

  const [clientName, documents] = await Promise.all([
    isAdmin
      ? fetchClients().then((clients) => clients.find((c) => c.id === params.id)?.name ?? null)
      : Promise.resolve(me?.clientName ?? null),
    fetchClientDocuments(params.id),
  ]);
  if (!clientName) notFound();

  return (
    <div className="space-y-6">
      <div>
        {isAdmin && (
          <Link href="/base-de-conocimiento" className="text-xs text-gray-500 hover:text-gray-700">
            ← Base de conocimiento
          </Link>
        )}
        <h1 className="text-xl font-semibold text-gray-900 mt-2">{clientName}</h1>
      </div>

      {isAdmin && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Subir documento</h2>
          <p className="text-xs text-gray-500">
            Formatos soportados: PDF, Word, PowerPoint, Excel, texto plano, OpenDocument, RTF. Máximo 50MB por
            archivo (límite del plan actual de Supabase Storage).
          </p>
          <DocumentUploadForm clientId={params.id} />
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Documentos ({documents.length})</h2>
        <DocumentList clientId={params.id} documents={documents} readOnly={!isAdmin} />
      </div>
    </div>
  );
}
