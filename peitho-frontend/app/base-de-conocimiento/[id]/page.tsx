import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchClients, fetchClientDocuments, fetchMe } from "@/lib/peithoBackend";
import KnowledgeBaseView from "@/components/KnowledgeBaseView";

// Un usuario "client" puede VER (no subir/borrar) la base de conocimiento de
// su propio cliente — aclaración explícita del usuario en la Fase E. El
// backend ya rechaza esto para otro client_id (404); acá se corta antes para
// no depender de que fetchClients() (admin-only) no reviente para ese rol.
export default async function ClientKnowledgeBasePage({ params }: { params: { id: string } }) {
  const me = await fetchMe();
  const isAdmin = me?.role === "admin";

  if (!isAdmin && me?.clientId !== params.id) notFound();

  const [client, documents] = await Promise.all([
    isAdmin
      ? fetchClients().then((clients) => clients.find((c) => c.id === params.id) ?? null)
      : Promise.resolve(me?.clientName ? { name: me.clientName, website_url: null } : null),
    fetchClientDocuments(params.id),
  ]);
  if (!client) notFound();
  const clientName = client.name;

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

      <KnowledgeBaseView
        clientId={params.id}
        documents={documents}
        readOnly={!isAdmin}
        websiteUrl={client.website_url}
      />
    </div>
  );
}
