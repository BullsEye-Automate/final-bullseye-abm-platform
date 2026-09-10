import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchMeeting, fetchMe, fetchClients } from "@/lib/peithoBackend";
import ResearchButton from "@/components/ResearchButton";
import ReprocessButton from "@/components/ReprocessButton";
import ReanalyzeButton from "@/components/ReanalyzeButton";
import LinkedinUrlForm from "@/components/LinkedinUrlForm";
import AssignClientForm from "@/components/AssignClientForm";
import DeleteMeetingButton from "@/components/DeleteMeetingButton";
import ResyncCalendarButton from "@/components/ResyncCalendarButton";
import DetailTabs from "@/components/DetailTabs";
import AnalysisView from "@/components/AnalysisView";
import MeetingVideoPlayer from "@/components/MeetingVideoPlayer";
import CollapsibleSection from "@/components/CollapsibleSection";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Agendada",
  captured: "Capturada",
  analyzed: "Analizada",
};

// timeZone explícito — ver el mismo fix en MeetingsTable.tsx (sin esto,
// toLocaleString usa la zona del servidor, no la de Chile).
function formatDate(value: string | null): string {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Santiago",
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </div>
  );
}

// Paso 5 — "Aprendizaje" y "Propuesta de correo" son pestañas nuevas del
// rediseño que todavía no tienen ninguna función real detrás (a diferencia
// de "Transcripción", que sí muestra transcript_text real). Se deja
// explícito en vez de inventar números/contenido falso en producción.
function PlaceholderTab({ description }: { description: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
      <p className="text-sm font-medium text-gray-700 mb-1">Próximamente</p>
      <p className="text-sm text-gray-500 max-w-md mx-auto">{description}</p>
    </div>
  );
}

export default async function MeetingDetailPage({ params }: { params: { id: string } }) {
  const [meeting, me] = await Promise.all([fetchMeeting(params.id), fetchMe()]);
  if (!meeting || !me) notFound();
  // Iniciar research / pegar la URL de LinkedIn son acciones internas de
  // BullsEye (gastan créditos de API, corrigen datos) — el backend ya las
  // restringe a admin (Fase E); acá solo se ocultan para no mostrar botones
  // que a un usuario "client" le van a fallar con 403.
  const isAdmin = me?.role === "admin";
  // GET /clients es admin-only en el backend — solo se pide si hace falta,
  // para no fallar con 403 en la carga de la página de un usuario "client".
  const clients = isAdmin ? await fetchClients() : [];

  const analysis = meeting.analysis;
  const preBrief = meeting.pre_brief;

  // Paso 5 — el análisis completo pasa de ser una lista plana de secciones a
  // ser la pestaña "Análisis" dentro de DetailTabs, junto a "Transcripción"
  // (dato real, meeting.transcript_text — Fase H), "Aprendizaje" y
  // "Propuesta de correo" (placeholders, ver PlaceholderTab arriba).
  const analysisTabContent = !analysis ? (
    <p className="text-sm text-gray-500">Todavía no hay análisis generado para esta reunión.</p>
  ) : (
    <AnalysisView analysis={analysis} ejecutivo={meeting.ejecutivo} />
  );

  // Panel de participantes sin métricas inventadas (sentiment/tiempo de
  // habla/% de palabra que sí muestra DIIO) — Peitho hoy solo tiene certeza
  // de quién es el ejecutivo y quién la contraparte, no de esas métricas por
  // hablante, así que solo se muestran los nombres reales.
  const transcriptTabContent = (
    <>
      {meeting.video_available && (
        <Section title="Video de la reunión">
          <p className="text-xs text-gray-400 -mt-1">Respaldo disponible por 30 días desde la fecha de la reunión.</p>
          <MeetingVideoPlayer meetingId={meeting.id} />
        </Section>
      )}
      {meeting.transcript_text ? (
        <Section title="Transcripción">
          <div className="flex items-center gap-2 text-xs text-gray-500 pb-3 border-b border-gray-50">
            <span className="font-medium text-gray-700">{meeting.ejecutivo ?? "Ejecutivo"}</span>
            <span>·</span>
            <span className="font-medium text-gray-700">{meeting.contraparte ?? "Contraparte"}</span>
          </div>
          <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans max-h-[600px] overflow-y-auto">
            {meeting.transcript_text}
          </pre>
        </Section>
      ) : (
        <p className="text-sm text-gray-500">Todavía no hay transcripción disponible para esta reunión.</p>
      )}
    </>
  );

  const aprendizajeTabContent = (
    <PlaceholderTab description="Esta sección todavía no está construida — no se muestran datos hasta que Peitho la genere de verdad." />
  );

  const propuestaCorreoTabContent = (
    <PlaceholderTab description="Generación de propuesta de correo de seguimiento — todavía no implementada." />
  );

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
        <div className="flex items-start gap-2">
          {isAdmin && meeting.recall_bot_available && (
            <ReprocessButton meetingId={meeting.id} status={meeting.status} />
          )}
          {isAdmin && meeting.status === "analyzed" && meeting.transcript_text && (
            <ReanalyzeButton meetingId={meeting.id} updatedAt={meeting.updated_at} />
          )}
          {isAdmin && <ResearchButton meetingId={meeting.id} initialStatus={meeting.pre_brief_status} />}
          {isAdmin && meeting.is_bot_invite && <ResyncCalendarButton meetingId={meeting.id} />}
          {isAdmin && <DeleteMeetingButton meetingId={meeting.id} />}
        </div>
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
            <div>
              <p className="text-xs font-medium text-gray-500">Sales Manager (cliente)</p>
              <p className="text-gray-700">{meeting.cliente_sales_manager ?? "—"}</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 pt-1">
            Datos tomados del excel de metas — si algo falta, es porque esta reunión no hizo match ahí todavía.
          </p>
        {isAdmin && <LinkedinUrlForm meetingId={meeting.id} initialUrl={meeting.contacto_linkedin_url} />}
        {isAdmin && (
          <AssignClientForm meetingId={meeting.id} clients={clients} initialClientId={meeting.client_id} />
        )}
      </Section>

      {/* Participantes reales de la llamada (nombre por diarización de
          Recall) — solo con transcript nativo de Recall, nunca con el flujo
          viejo de la extensión de Chrome. El primero (más palabras) es quien
          el backend detectó como `ejecutivo` — reemplaza depender de quién
          organizó el evento en el calendario, que puede no ser quien
          realmente participa de la llamada. */}
      {meeting.participantes && meeting.participantes.length > 0 && (
        <Section title="Participantes de la llamada">
          <div className="space-y-2.5">
            {(() => {
              const total = meeting.participantes!.reduce((sum, p) => sum + p.palabras, 0);
              return meeting.participantes!.map((p, i) => {
                const pct = total > 0 ? Math.round((p.palabras / total) * 100) : 0;
                return (
                  <div key={p.nombre} className="flex items-center gap-3 text-sm">
                    <span className="w-44 shrink-0 truncate text-gray-700">
                      {p.nombre}
                      {i === 0 && (
                        <span
                          className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: "rgba(98,224,216,0.15)", color: "#251762" }}
                        >
                          Ejecutivo detectado
                        </span>
                      )}
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#251762" }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs text-gray-400">{pct}%</span>
                  </div>
                );
              });
            })()}
          </div>
          <p className="text-xs text-gray-400 pt-1">
            Detectado automáticamente por quién habla más en la grabación — no depende de quién organizó el
            evento en el calendario.
          </p>
        </Section>
      )}

      {preBrief && (
        <CollapsibleSection label="research" defaultOpen={!analysis}>
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

          {!!preBrief.temas_recomendados?.length && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-1">Temas recomendados (según base de conocimiento)</p>
              <ul className="list-disc list-inside text-sm text-gray-700 space-y-0.5">
                {preBrief.temas_recomendados.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}

          {!!preBrief.temas_evitar?.length && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-1">Temas a evitar</p>
              <ul className="list-disc list-inside text-sm text-gray-700 space-y-0.5">
                {preBrief.temas_evitar.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}

          {!!preBrief.casos_exito_sugeridos?.length && (
            <div className="pt-2">
              <p className="text-xs font-medium text-gray-500 mb-2">Casos de éxito sugeridos</p>
              <ul className="space-y-2">
                {preBrief.casos_exito_sugeridos.map((c, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-gray-900">{c.caso}</span>
                    {c.por_que_aplica && <p className="text-gray-600 mt-0.5">{c.por_que_aplica}</p>}
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
        </CollapsibleSection>
      )}

      {meeting.pre_brief_status === "failed" && (
        <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-4">
          <p className="text-sm text-red-600">El research falló — intenta de nuevo con el botón de arriba.</p>
        </div>
      )}

      {!analysis && !meeting.transcript_text ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <p className="text-sm text-gray-500">
            Todavía no hay análisis para esta reunión (estado actual:{" "}
            {STATUS_LABEL[meeting.status] ?? meeting.status}). El análisis se genera automáticamente
            cuando termina de grabarse la llamada.
          </p>
        </div>
      ) : (
        <DetailTabs
          tabs={[
            { key: "analisis", label: "Análisis", content: analysisTabContent },
            { key: "transcripcion", label: "Transcripción", content: transcriptTabContent },
            { key: "aprendizaje", label: "Aprendizaje", content: aprendizajeTabContent },
            { key: "propuesta-correo", label: "Propuesta de correo", content: propuestaCorreoTabContent },
          ]}
        />
      )}
    </div>
  );
}
