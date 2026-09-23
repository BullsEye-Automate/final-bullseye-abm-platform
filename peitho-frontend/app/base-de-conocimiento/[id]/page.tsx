import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchClients, fetchClientDocuments, fetchClientExecutives, fetchMe } from "@/lib/peithoBackend";
import KnowledgeBaseView from "@/components/KnowledgeBaseView";
import ClientExecutivesManager from "@/components/ClientExecutivesManager";

// Un usuario "client" puede VER (no subir/borrar) la base de conocimiento de
// su propio cliente — aclaración explícita del usuario en la Fase E. El
// backend ya rechaza esto para otro client_id (404); acá se corta antes para
// no depender de que fetchClients() (admin-only) no reviente para ese rol.
//
// fetchClients(true) (10-09-2026): el admin llega acá desde el listado
// agrupado por external_id (/base-de-conocimiento) — hay que buscar en esa
// MISMA vista agrupada para encontrar el `id` representativo del grupo y
// mostrar el nombre combinado (ej. "CChC + CChC - Valle"). fetchClientDocuments
// ya trae documentos de todo el grupo sin importar esto (ver
// resolveClientGroupIds en el backend).
export default async function ClientKnowledgeBasePage({ params }: { params: { id: string } }) {
  const me = await fetchMe();
  const isAdmin = me?.role === "admin";

  if (!isAdmin && me?.clientId !== params.id) notFound();
  // "Usuario cliente" (clientSubRole==='user', ver migración 032) no tiene
  // acceso a la base de conocimiento — el backend devuelve 403 acá (no 404),
  // así que se corta antes de llamar a fetchClientDocuments (que revienta
  // con cualquier respuesta que no sea res.ok o 404).
  if (!isAdmin && me?.clientSubRole === "user") {
    return (
      <p className="text-sm text-gray-500">
        Tu cuenta no tiene acceso a esta sección — contacta al administrador de tu empresa.
      </p>
    );
  }

  const [client, documents, executives] = await Promise.all([
    isAdmin
      ? fetchClients(true).then((clients) => clients.find((c) => c.id === params.id) ?? null)
      : Promise.resolve(me?.clientName ? { name: me.clientName, website_url: null } : null),
    fetchClientDocuments(params.id),
    fetchClientExecutives(params.id),
  ]);
  if (!client) notFound();
  const clientName = client.name;
  // Roster de ejecutivos (23-09-2026): admin de BullsEye o "admin cliente" de
  // esta empresa pueden agregar/borrar — decisión explícita del usuario de
  // dejar que el propio cliente gestione su equipo (distinto del criterio de
  // los documentos de arriba, que siguen admin-only).
  const canManageExecutives = isAdmin || me?.clientSubRole === "admin";

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

      <ClientExecutivesManager clientId={params.id} executives={executives} canManage={canManageExecutives} />

      <KnowledgeBaseView
        clientId={params.id}
        documents={documents}
        readOnly={!isAdmin}
        websiteUrl={client.website_url}
      />
    </div>
  );
}
