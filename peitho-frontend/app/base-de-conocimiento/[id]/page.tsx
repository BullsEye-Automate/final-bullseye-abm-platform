import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchClients, fetchClientDocuments } from "@/lib/peithoBackend";
import DocumentUploadForm from "@/components/DocumentUploadForm";
import DocumentList from "@/components/DocumentList";

export default async function ClientKnowledgeBasePage({ params }: { params: { id: string } }) {
  const [clients, documents] = await Promise.all([fetchClients(), fetchClientDocuments(params.id)]);
  const client = clients.find((c) => c.id === params.id);
  if (!client) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/base-de-conocimiento" className="text-xs text-gray-500 hover:text-gray-700">
          ← Base de conocimiento
        </Link>
        <h1 className="text-xl font-semibold text-gray-900 mt-2">{client.name}</h1>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Subir documento</h2>
        <p className="text-xs text-gray-500">
          Formatos soportados: PDF, Word, PowerPoint, Excel, texto plano, OpenDocument, RTF. Máximo 50MB por archivo
          (límite del plan actual de Supabase Storage).
        </p>
        <DocumentUploadForm clientId={client.id} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Documentos ({documents.length})</h2>
        <DocumentList clientId={client.id} documents={documents} />
      </div>
    </div>
  );
}
