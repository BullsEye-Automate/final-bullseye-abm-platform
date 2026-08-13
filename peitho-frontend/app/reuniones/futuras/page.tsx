import { fetchMeetings } from "@/lib/peithoBackend";
import MeetingsTable from "@/components/MeetingsTable";

// Módulo 1 (esqueleto): listado simple. La página de detalle con el research
// de empresa/prospecto (LinkedIn, señales comerciales) es una tarea aparte.
export default async function ReunionesFuturasPage() {
  const meetings = await fetchMeetings("upcoming");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Reuniones futuras</h1>
        <p className="text-sm text-gray-500 mt-1">Preparación de reuniones agendadas.</p>
      </div>
      <MeetingsTable meetings={meetings} detailBasePath="/reuniones" />
    </div>
  );
}
