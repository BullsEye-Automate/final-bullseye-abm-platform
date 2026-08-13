import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchMeeting } from "@/lib/peithoBackend";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Agendada",
  captured: "Capturada",
  analyzed: "Analizada",
};

function formatDate(value: string | null): string {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </div>
  );
}

const METRIC_LABEL: Record<string, string> = {
  descubrimiento: "Descubrimiento",
  escucha_activa: "Escucha activa",
  manejo_objeciones: "Manejo de objeciones",
  avance_hacia_cierre: "Avance hacia el cierre",
  claridad_propuesta_valor: "Claridad de la propuesta de valor",
};

export default async function MeetingDetailPage({ params }: { params: { id: string } }) {
  const meeting = await fetchMeeting(params.id);
  if (!meeting) notFound();

  const analysis = meeting.analysis;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reuniones/futuras" className="text-xs text-gray-500 hover:text-gray-700">
          ← Reuniones
        </Link>
        <h1 className="text-xl font-semibold text-gray-900 mt-2">
          {meeting.contraparte ?? "Reunión"} {meeting.empresa_contraparte ? `— ${meeting.empresa_contraparte}` : ""}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {formatDate(meeting.start_time)} · {meeting.ejecutivo ?? "—"} ·{" "}
          {STATUS_LABEL[meeting.status] ?? meeting.status}
        </p>
      </div>

      {!analysis ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <p className="text-sm text-gray-500">
            Todavía no hay análisis para esta reunión (estado actual:{" "}
            {STATUS_LABEL[meeting.status] ?? meeting.status}). El análisis se genera automáticamente
            cuando la extensión de Chrome sube el audio capturado.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {analysis.prediccion_exito && (
            <Section title="Predicción de éxito">
              <div className="flex items-center gap-3">
                <span
                  className="text-2xl font-bold"
                  style={{ color: "#251762" }}
                >
                  {analysis.prediccion_exito.puntaje ?? "—"}
                </span>
                <span className="text-sm text-gray-500">{analysis.prediccion_exito.etiqueta}</span>
              </div>
              {analysis.prediccion_exito.justificacion && (
                <p className="text-sm text-gray-700">{analysis.prediccion_exito.justificacion}</p>
              )}
            </Section>
          )}

          {analysis.apuntes_clave?.resumen_general && (
            <Section title="Resumen general">
              <p className="text-sm text-gray-700">{analysis.apuntes_clave.resumen_general}</p>
            </Section>
          )}

          {analysis.metricas_desempeno_ejecutivo && (
            <Section title="Desempeño del ejecutivo">
              <div className="divide-y divide-gray-50">
                {Object.entries(analysis.metricas_desempeno_ejecutivo).map(([key, metric]) => (
                  <div key={key} className="py-2 flex items-start gap-4">
                    <span className="text-sm font-medium text-gray-900 w-56 shrink-0">
                      {METRIC_LABEL[key] ?? key}
                    </span>
                    <span className="text-sm font-semibold" style={{ color: "#251762" }}>
                      {metric?.puntaje ?? "—"}
                    </span>
                    <span className="text-sm text-gray-500">{metric?.comentario}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {!!analysis.objeciones?.length && (
            <Section title="Objeciones">
              <ul className="space-y-2">
                {analysis.objeciones.map((o, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-gray-900">{o.tipo}</span>
                    {o.contexto && <p className="text-gray-600 mt-0.5">{o.contexto}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!!analysis.dolores_cliente?.length && (
            <Section title="Dolores del cliente">
              <ul className="space-y-2">
                {analysis.dolores_cliente.map((d, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-gray-900">{d.dolor}</span>
                    {d.contexto && <p className="text-gray-600 mt-0.5">{d.contexto}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!!analysis.compromisos?.length && (
            <Section title="Compromisos">
              <ul className="space-y-1 text-sm text-gray-700 list-disc list-inside">
                {analysis.compromisos.map((c, i) => (
                  <li key={i}>
                    {c.descripcion} {c.completado ? "(completado)" : ""}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!!analysis.temas_pendientes?.length && (
            <Section title="Temas pendientes">
              <ul className="space-y-3">
                {analysis.temas_pendientes.map((t, i) => (
                  <li key={i} className="text-sm">
                    <p className="font-medium text-gray-900">{t.pregunta}</p>
                    {t.respuesta_sugerida && (
                      <p className="text-gray-600 mt-0.5">Sugerencia: {t.respuesta_sugerida}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!!analysis.recomendaciones_proximos_pasos?.length && (
            <Section title="Recomendaciones — próximos pasos">
              <ul className="space-y-3">
                {analysis.recomendaciones_proximos_pasos.map((r, i) => (
                  <li key={i} className="text-sm">
                    <p className="font-medium text-gray-900">{r.titulo}</p>
                    {r.detalle && <p className="text-gray-600 mt-0.5">{r.detalle}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
