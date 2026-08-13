import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchMeeting } from "@/lib/peithoBackend";
import ResearchButton from "@/components/ResearchButton";
import LinkedinUrlForm from "@/components/LinkedinUrlForm";

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
  const preBrief = meeting.pre_brief;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
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
        <ResearchButton meetingId={meeting.id} initialStatus={meeting.pre_brief_status} />
      </div>

      {/* Siempre visible (no solo cuando hay match del excel) — el formulario de
          LinkedIn de abajo debe estar disponible aunque esta reunión no haya
          hecho match todavía. */}
      <Section title="Ficha del contacto">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs font-medium text-gray-500">Nombre</p>
              <p className="text-gray-700">{meeting.contacto_nombre ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Cargo</p>
              <p className="text-gray-700">{meeting.contacto_cargo ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Industria</p>
              <p className="text-gray-700">{meeting.contacto_industria ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Cliente BullsEye</p>
              <p className="text-gray-700">{meeting.cliente_bullseye ?? "—"}</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 pt-1">
            Datos tomados del excel de metas — si algo falta, es porque esta reunión no hizo match ahí todavía.
          </p>
        <LinkedinUrlForm meetingId={meeting.id} initialUrl={meeting.contacto_linkedin_url} />
      </Section>

      {preBrief && (
        <Section title="Investigación de empresa y prospecto">
          {preBrief.resumen_contexto && <p className="text-sm text-gray-700">{preBrief.resumen_contexto}</p>}

          {preBrief.perfil_empresa && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-1">Empresa</p>
              <p className="text-sm text-gray-700">
                {preBrief.perfil_empresa.rubro ?? "Rubro desconocido"}
                {preBrief.perfil_empresa.tamaño_estimado ? ` · ${preBrief.perfil_empresa.tamaño_estimado}` : ""}
              </p>
              {preBrief.perfil_empresa.info_insuficiente && (
                <p className="text-xs text-gray-400 mt-0.5">Información encontrada limitada.</p>
              )}
              {!!preBrief.perfil_empresa.senales_relevantes?.length && (
                <ul className="list-disc list-inside text-sm text-gray-700 mt-1 space-y-0.5">
                  {preBrief.perfil_empresa.senales_relevantes.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {preBrief.perfil_contacto && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-1">Contacto</p>
              <p className="text-sm text-gray-700">
                {preBrief.perfil_contacto.cargo_estimado ?? "Cargo desconocido"}
                {preBrief.perfil_contacto.rol_probable_en_decision
                  ? ` · rol probable: ${preBrief.perfil_contacto.rol_probable_en_decision}`
                  : ""}
              </p>
            </div>
          )}

          {!!preBrief.experiencia_contacto?.length && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-1">Experiencia laboral previa</p>
              <ul className="text-sm text-gray-700 space-y-0.5">
                {preBrief.experiencia_contacto.map((e, i) => (
                  <li key={i}>
                    {e.cargo} — {e.empresa}
                    {e.periodo ? ` (${e.periodo})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!!preBrief.icebreakers_sugeridos?.length && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-1">Icebreakers sugeridos</p>
              <ul className="list-disc list-inside text-sm text-gray-700 space-y-0.5">
                {preBrief.icebreakers_sugeridos.map((ib, i) => (
                  <li key={i}>{ib}</li>
                ))}
              </ul>
            </div>
          )}

          {!!preBrief.competidores_directos?.length && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-1">Competidores directos</p>
              <ul className="text-sm text-gray-700 space-y-0.5">
                {preBrief.competidores_directos.map((c, i) => (
                  <li key={i}>
                    <span className="font-medium text-gray-900">{c.nombre}</span>
                    {c.comentario ? ` — ${c.comentario}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!!preBrief.hilos_abiertos?.length && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-2">Hilos abiertos de la reunión anterior</p>
              <ul className="space-y-2">
                {preBrief.hilos_abiertos.map((h, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-gray-900">
                      {h.tema} {h.prioridad ? `(${h.prioridad})` : ""}
                    </span>
                    {h.sugerencia && <p className="text-gray-600 mt-0.5">{h.sugerencia}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!!preBrief.objeciones_ya_planteadas?.length && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-2">Objeciones ya planteadas</p>
              <ul className="space-y-2">
                {preBrief.objeciones_ya_planteadas.map((o, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-gray-900">{o.objecion}</span>
                    {o.como_evitar_repetirla && <p className="text-gray-600 mt-0.5">{o.como_evitar_repetirla}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preBrief.objetivo_sugerido_reunion && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-1">Objetivo sugerido</p>
              <p className="text-sm text-gray-700">{preBrief.objetivo_sugerido_reunion}</p>
            </div>
          )}

          {!!preBrief.preguntas_clave_a_indagar?.length && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-1">Preguntas clave a indagar</p>
              <ul className="list-disc list-inside text-sm text-gray-700 space-y-0.5">
                {preBrief.preguntas_clave_a_indagar.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {!!preBrief.riesgos_a_considerar?.length && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-1">Riesgos a considerar</p>
              <ul className="list-disc list-inside text-sm text-gray-700 space-y-0.5">
                {preBrief.riesgos_a_considerar.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {preBrief.recomendacion_personalizacion && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-1">Recomendación de personalización</p>
              <p className="text-sm text-gray-700">{preBrief.recomendacion_personalizacion}</p>
            </div>
          )}
        </Section>
      )}

      {meeting.pre_brief_status === "failed" && (
        <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-4">
          <p className="text-sm text-red-600">El research falló — intenta de nuevo con el botón de arriba.</p>
        </div>
      )}

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

          {analysis.desempeno_vendedor && (
            <Section title="Desempeño del vendedor">
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold" style={{ color: "#251762" }}>
                  {analysis.desempeno_vendedor.puntaje ?? "—"}
                </span>
                <span className="text-sm text-gray-500">/ 10</span>
              </div>
              {analysis.desempeno_vendedor.resumen && (
                <p className="text-sm text-gray-700">{analysis.desempeno_vendedor.resumen}</p>
              )}
              {!!analysis.desempeno_vendedor.oportunidades_mejora?.length && (
                <div className="pt-2">
                  <p className="text-xs font-medium text-gray-500 mb-2">Oportunidades de mejora</p>
                  <ul className="space-y-2">
                    {analysis.desempeno_vendedor.oportunidades_mejora.map((o, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium text-gray-900">{o.area}</span>
                        {o.sugerencia && <p className="text-gray-600 mt-0.5">{o.sugerencia}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
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
