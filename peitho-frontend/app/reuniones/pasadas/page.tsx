import { fetchMeetings, fetchClients, fetchClientExecutives, fetchMe } from "@/lib/peithoBackend";
import ReunionesPasadasView from "@/components/ReunionesPasadasView";
import ClientFilter from "@/components/ClientFilter";

// Módulo 2 (esqueleto): listado simple. La página de detalle tipo DIIO (con
// el análisis completo y el puntaje 1-10 de desempeño) es una tarea aparte.
// Fase E: mismo criterio que /reuniones/futuras — el filtro de cliente es
// solo para admin, el rol "client" ya viene scopeado desde el backend.
export default async function ReunionesPasadasPage({
  searchParams,
}: {
  searchParams: { client_id?: string };
}) {
  const me = await fetchMe();
  if (!me) {
    return <p className="text-sm text-gray-500">Tu cuenta todavía no tiene acceso a Peitho — contacta al administrador.</p>;
  }
  const isAdmin = me.role === "admin";
  const clientId = isAdmin ? searchParams.client_id : undefined;
  // Pedido explícito del usuario (14-10-2026): el filtro de "Ejecutivo" debe
  // mostrar solo el roster real del cliente (client_executives, administrado
  // en la Base de conocimiento) — un solo cliente conocido en este momento
  // (el propio de un rol "client", o el que el admin ya eligió en el filtro
  // de arriba). Sin un cliente único (admin viendo todos los clientes
  // mezclados) no hay un roster puntual que pedir — ReunionesPasadasView cae
  // al criterio viejo (mejor esfuerzo) solo en ese caso.
  const executivesClientId = isAdmin ? clientId : me.clientId ?? undefined;

  const [meetings, clients, executives] = await Promise.all([
    fetchMeetings("past", clientId),
    isAdmin ? fetchClients() : Promise.resolve([]),
    executivesClientId ? fetchClientExecutives(executivesClientId) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Reuniones pasadas</h1>
          <p className="text-sm text-gray-500 mt-1">Análisis de reuniones ya capturadas.</p>
        </div>
        {isAdmin && <ClientFilter clients={clients} />}
      </div>
      <ReunionesPasadasView
        meetings={meetings}
        detailBasePath="/reuniones"
        showClientColumn={isAdmin}
        clients={isAdmin ? clients : undefined}
        executives={executives}
      />
    </div>
  );
}
