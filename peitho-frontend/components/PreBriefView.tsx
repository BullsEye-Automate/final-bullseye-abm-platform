import type { PreBrief } from "@/lib/peithoBackend";
import { CardShell, SectionHeading, TagList } from "@/components/AnalysisView";

// Rediseño del research pre-reunión (10-09-2026) — pedido explícito del
// usuario: "está brutal la info, pero se ve muy plano, igual como nos pasaba
// con el análisis post reunión". Mismos datos de siempre (meeting.pre_brief),
// reorganizados con el mismo lenguaje visual que ya se usó para AnalysisView
// (tarjetas/badges/listas con punto de color en vez de encabezados + párrafos
// corridos) — reusa CardShell/SectionHeading/TagList de ese archivo para no
// duplicar el sistema de diseño. Usado tanto en /reuniones/[id] (adentro de
// Peitho) como en la página pública /research-compartido/[token] (sin login).

function PriorityBadge({ prioridad }: { prioridad?: string }) {
  if (!prioridad) return null;
  const key = prioridad.trim().toLowerCase();
  const [bg, fg] =
    key === "alta" ? ["#FBE7E4", "#C0392B"] : key === "media" ? ["#FBF1DF", "#B4740E"] : ["#F3F2F7", "#635C79"];
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0" style={{ background: bg, color: fg }}>
      {prioridad}
    </span>
  );
}

// Lista simple con puntos numerados — mismo patrón que "Recomendaciones —
// próximos pasos" en AnalysisView.tsx, reusado acá para icebreakers y
// preguntas clave (ambos son "cosas para decir/preguntar en orden", no
// hallazgos sueltos como los que usan TagList).
function NumberedList({ items }: { items: string[] }) {
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => (
        <div key={i} className="flex gap-3 border border-gray-100 rounded-xl px-4 py-3">
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
            style={{ background: "#251762" }}
          >
            {i + 1}
          </span>
          <p className="text-sm text-gray-700 leading-relaxed">{item}</p>
        </div>
      ))}
    </div>
  );
}

export default function PreBriefView({ preBrief }: { preBrief: PreBrief }) {
  const empresa = preBrief.perfil_empresa;
  const contacto = preBrief.perfil_contacto;

  return (
    <div className="space-y-5">
      {(preBrief.resumen_contexto || preBrief.es_primera_reunion !== undefined) && (
        <CardShell className="p-5">
          <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Contexto</p>
            {preBrief.es_primera_reunion !== undefined && (
              <span
                className="text-xs font-semibold px-2.5 py-0.5 rounded-full shrink-0"
                style={
                  preBrief.es_primera_reunion
                    ? { background: "#E6F6EE", color: "#1F8A5C" }
                    : { background: "rgba(37,23,98,0.08)", color: "#251762" }
                }
              >
                {preBrief.es_primera_reunion ? "Primera reunión" : "Reunión de seguimiento"}
              </span>
            )}
          </div>
          {preBrief.resumen_contexto && (
            <p className="text-sm text-gray-700 leading-relaxed">{preBrief.resumen_contexto}</p>
          )}
        </CardShell>
      )}

      {(empresa || contacto) && (
        <div className="grid md:grid-cols-2 gap-4">
          {empresa && (
            <CardShell className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Perfil de empresa</p>
              <p className="text-sm font-semibold text-gray-900">
                {empresa.rubro ?? "Rubro desconocido"}
                {empresa.tamaño_estimado ? ` · ${empresa.tamaño_estimado}` : ""}
              </p>
              {empresa.info_insuficiente && (
                <p className="text-xs text-gray-400 mt-1">Información encontrada limitada.</p>
              )}
              {!!empresa.senales_relevantes?.length && (
                <div className="mt-3">
                  <TagList dotColor="#251762" items={empresa.senales_relevantes.map((s) => ({ title: s }))} />
                </div>
              )}
            </CardShell>
          )}
          {contacto && (
            <CardShell className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Perfil del contacto</p>
              <p className="text-sm font-semibold text-gray-900">{contacto.cargo_estimado ?? "Cargo desconocido"}</p>
              {contacto.rol_probable_en_decision && (
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                  Rol probable en la decisión: {contacto.rol_probable_en_decision}
                </p>
              )}
            </CardShell>
          )}
        </div>
      )}

      {!!preBrief.experiencia_contacto?.length && (
        <CardShell className="p-5">
          <SectionHeading>Experiencia laboral previa</SectionHeading>
          <TagList
            dotColor="#251762"
            items={preBrief.experiencia_contacto.map((e) => ({
              title: [e.cargo, e.empresa].filter(Boolean).join(" — "),
              body: e.periodo ?? undefined,
            }))}
          />
        </CardShell>
      )}

      {!!preBrief.icebreakers_sugeridos?.length && (
        <CardShell className="p-5">
          <SectionHeading>Icebreakers sugeridos</SectionHeading>
          <NumberedList items={preBrief.icebreakers_sugeridos} />
        </CardShell>
      )}

      {!!preBrief.competidores_directos?.length && (
        <CardShell className="p-5">
          <SectionHeading>Competidores directos</SectionHeading>
          <TagList
            dotColor="#B4740E"
            items={preBrief.competidores_directos.map((c) => ({ title: c.nombre ?? "", body: c.comentario }))}
          />
        </CardShell>
      )}

      {(preBrief.objetivo_sugerido_reunion || preBrief.recomendacion_personalizacion) && (
        <div className="grid md:grid-cols-2 gap-4">
          {preBrief.objetivo_sugerido_reunion && (
            <CardShell className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Objetivo sugerido</p>
              <p className="text-sm text-gray-700 leading-relaxed border-l-2 pl-3" style={{ borderColor: "#62E0D8" }}>
                {preBrief.objetivo_sugerido_reunion}
              </p>
            </CardShell>
          )}
          {preBrief.recomendacion_personalizacion && (
            <CardShell className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                Recomendación de personalización
              </p>
              <p className="text-sm text-gray-700 leading-relaxed border-l-2 pl-3" style={{ borderColor: "#62E0D8" }}>
                {preBrief.recomendacion_personalizacion}
              </p>
            </CardShell>
          )}
        </div>
      )}

      {!!preBrief.preguntas_clave_a_indagar?.length && (
        <CardShell className="p-5">
          <SectionHeading>Preguntas clave a indagar</SectionHeading>
          <NumberedList items={preBrief.preguntas_clave_a_indagar} />
        </CardShell>
      )}

      {(!!preBrief.hilos_abiertos?.length || !!preBrief.objeciones_ya_planteadas?.length) && (
        <div className="grid md:grid-cols-2 gap-4">
          {!!preBrief.hilos_abiertos?.length && (
            <CardShell className="p-5">
              <SectionHeading>Hilos abiertos de la reunión anterior</SectionHeading>
              <div className="space-y-2">
                {preBrief.hilos_abiertos.map((h, i) => (
                  <div key={i} className="bg-gray-50/60 border border-gray-100 rounded-xl px-3.5 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900">{h.tema}</p>
                      <PriorityBadge prioridad={h.prioridad} />
                    </div>
                    {h.sugerencia && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{h.sugerencia}</p>}
                  </div>
                ))}
              </div>
            </CardShell>
          )}
          {!!preBrief.objeciones_ya_planteadas?.length && (
            <CardShell className="p-5">
              <SectionHeading>Objeciones ya planteadas</SectionHeading>
              <TagList
                dotColor="#B4740E"
                items={preBrief.objeciones_ya_planteadas.map((o) => ({
                  title: o.objecion ?? "",
                  body: o.como_evitar_repetirla,
                }))}
              />
            </CardShell>
          )}
        </div>
      )}

      {!!preBrief.riesgos_a_considerar?.length && (
        <CardShell className="p-5">
          <SectionHeading>Riesgos a considerar</SectionHeading>
          <TagList dotColor="#C0392B" items={preBrief.riesgos_a_considerar.map((r) => ({ title: r }))} />
        </CardShell>
      )}

      {(!!preBrief.temas_recomendados?.length || !!preBrief.temas_evitar?.length) && (
        <div className="grid md:grid-cols-2 gap-4">
          {!!preBrief.temas_recomendados?.length && (
            <CardShell className="p-5" >
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: "#1F8A5C" }}>
                Temas recomendados (según base de conocimiento)
              </p>
              <TagList dotColor="#1F8A5C" items={preBrief.temas_recomendados.map((t) => ({ title: t }))} />
            </CardShell>
          )}
          {!!preBrief.temas_evitar?.length && (
            <CardShell className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: "#C0392B" }}>
                Temas a evitar
              </p>
              <TagList dotColor="#C0392B" items={preBrief.temas_evitar.map((t) => ({ title: t }))} />
            </CardShell>
          )}
        </div>
      )}

      {!!preBrief.casos_exito_sugeridos?.length && (
        <CardShell className="p-5">
          <SectionHeading>Casos de éxito sugeridos</SectionHeading>
          <TagList
            dotColor="#251762"
            items={preBrief.casos_exito_sugeridos.map((c) => ({ title: c.caso ?? "", body: c.por_que_aplica }))}
          />
        </CardShell>
      )}
    </div>
  );
}
