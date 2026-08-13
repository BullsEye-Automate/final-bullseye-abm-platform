import { fetchMeetings } from "@/lib/peithoBackend";
import MeetingsTable from "@/components/MeetingsTable";

// Módulo 2 (esqueleto): listado simple. La página de detalle tipo DIIO (con
// el análisis completo y el puntaje 1-10 de desempeño) es una tarea aparte.
export default async function ReunionesPasadasPage() {
  const meetings = await fetchMeetings("past");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Reuniones pasadas</h1>
        <p className="text-sm text-gray-500 mt-1">Análisis de reuniones ya capturadas.</p>
      </div>
      <MeetingsTable meetings={meetings} detailBasePath="/reuniones/pasadas" />
    </div>
  );
}
