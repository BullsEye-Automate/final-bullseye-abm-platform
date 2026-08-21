import { fetchMeetings, fetchClients, fetchMe } from "@/lib/peithoBackend";
import MeetingsTable from "@/components/MeetingsTable";
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

  const [meetings, clients] = await Promise.all([
    fetchMeetings("past", clientId),
    isAdmin ? fetchClients() : Promise.resolve([]),
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
      <MeetingsTable meetings={meetings} detailBasePath="/reuniones" showClientColumn={isAdmin} />
    </div>
  );
}
