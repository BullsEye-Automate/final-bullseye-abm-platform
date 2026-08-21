import { fetchMeetings, fetchClients, fetchMe } from "@/lib/peithoBackend";
import MeetingsTable from "@/components/MeetingsTable";
import ClientFilter from "@/components/ClientFilter";

// Módulo 1 (esqueleto): listado simple. La página de detalle con el research
// de empresa/prospecto (LinkedIn, señales comerciales) es una tarea aparte.
// Fase E: el backend ya scopea por client_id para un usuario "client" — el
// filtro de cliente de acá abajo solo aplica (y solo se muestra) para admin.
export default async function ReunionesFuturasPage({
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
    fetchMeetings("upcoming", clientId),
    isAdmin ? fetchClients() : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Reuniones futuras</h1>
          <p className="text-sm text-gray-500 mt-1">Preparación de reuniones agendadas.</p>
        </div>
        {isAdmin && <ClientFilter clients={clients} />}
      </div>
      <MeetingsTable meetings={meetings} detailBasePath="/reuniones" showClientColumn={isAdmin} />
    </div>
  );
}
