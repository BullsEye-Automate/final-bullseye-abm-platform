import type { MeetingAnalysis } from "@/lib/peithoBackend";

// Rediseño (09-09-2026) de la pestaña "Análisis" — pedido explícito del
// usuario tras comparar con DIIO ("se ve mucho texto"). Mismos datos de
// siempre (meeting.analysis), reorganizados en tarjetas/badges/barras en vez
// de listas de párrafos corridos. Colores y tipografía son los mismos que ya
// usa el resto de Peitho (#251762/#62E0D8, Outfit vía la fuente global) — no
// es una identidad nueva.

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

// Mismo umbral que PrediccionBadge en MeetingsTable.tsx (escala 1-5): >=4
// verde, >=3 ámbar, el resto rojo. Se repite acá en vez de importarlo porque
// ese componente es específico de la tabla (recibe `puntaje` a secas, sin
// wrapper); mantener el mismo umbral es lo que importa, no compartir código.
function scoreColors(score: number | null | undefined, scale: 5 | 10 = 5) {
  if (score == null) return { bg: "#F3F2F7", fg: "#635C79" };
  const ratio = score / scale;
  if (ratio >= 0.8) return { bg: "#E6F6EE", fg: "#1F8A5C" };
  if (ratio >= 0.6) return { bg: "#FBF1DF", fg: "#B4740E" };
  return { bg: "#FBE7E4", fg: "#C0392B" };
}

function CardShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm ${className}`}>{children}</div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-gray-900 mb-3">{children}</h2>;
}

const METRIC_LABEL: Record<string, string> = {
  descubrimiento: "Descubrimiento",
  escucha_activa: "Escucha activa",
  manejo_objeciones: "Manejo de objeciones",
  avance_hacia_cierre: "Avance hacia el cierre",
  claridad_propuesta_valor: "Claridad de la propuesta de valor",
};

function TagList({
  items,
  dotColor,
}: {
  items: Array<{ title: string; body?: string }>;
  dotColor: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2.5 bg-gray-50/60 border border-gray-100 rounded-xl px-3.5 py-3">
          <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: dotColor }} />
          <div>
            <p className="text-sm font-semibold text-gray-900">{item.title}</p>
            {item.body && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.body}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AnalysisView({
  analysis,
  ejecutivo,
}: {
  analysis: MeetingAnalysis;
  ejecutivo: string | null;
}) {
  const puntajeVendedor = analysis.desempeno_vendedor?.puntaje ?? null;
  const puntajePrediccion = analysis.prediccion_exito?.puntaje ?? null;
  const prediccionColors = scoreColors(puntajePrediccion, 5);

  return (
    <div className="space-y-5">
      {/* Franja resumen: desempeño del vendedor + predicción de éxito */}
      {(analysis.desempeno_vendedor || analysis.prediccion_exito) && (
        <div className="grid md:grid-cols-2 gap-4">
          {analysis.desempeno_vendedor && (
            <CardShell className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">
                Desempeño del vendedor
              </p>
              {ejecutivo && (
                <div className="flex items-center gap-2.5 mb-3">
                  <span
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: "rgba(37,23,98,0.08)", color: "#251762" }}
                  >
                    {initials(ejecutivo)}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 leading-tight">{ejecutivo}</p>
                    <p className="text-xs text-gray-400 leading-tight">Ejecutivo/a de ventas</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, ((puntajeVendedor ?? 0) / 10) * 100))}%`,
                      background: "linear-gradient(90deg, #251762, #62E0D8)",
                    }}
                  />
                </div>
                <span className="text-xl font-bold shrink-0" style={{ color: "#251762" }}>
                  {puntajeVendedor ?? "—"}
                  <span className="text-xs font-medium text-gray-400">/10</span>
                </span>
              </div>
              {analysis.desempeno_vendedor.resumen && (
                <p className="text-sm text-gray-600 mt-3 leading-relaxed">{analysis.desempeno_vendedor.resumen}</p>
              )}
            </CardShell>
          )}

          {analysis.prediccion_exito && (
            <CardShell className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">
                Predicción de éxito
              </p>
              <span
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1 rounded-full"
                style={{ background: prediccionColors.bg, color: prediccionColors.fg }}
              >
                {puntajePrediccion ?? "—"}/5 · {analysis.prediccion_exito.etiqueta}
              </span>
              {analysis.prediccion_exito.justificacion && (
                <p className="text-sm text-gray-600 mt-3 leading-relaxed">
                  {analysis.prediccion_exito.justificacion}
                </p>
              )}
            </CardShell>
          )}
        </div>
      )}

      {/* Fit Score (10-09-2026) — qué tan bien calza el prospecto contra el ICP
          real del cliente (base de conocimiento), no si el deal va a avanzar
          (eso es prediccion_exito, arriba). puntaje viene null con
          justificación cuando el cliente no tiene ICP cargado todavía —
          nunca se inventa un número, se muestra "Sin ICP cargado" en vez de
          ocultar la tarjeta, para que quede visible que falta ese dato. */}
      {(analysis.fit_empresa || analysis.fit_contacto) && (
        <div className="grid md:grid-cols-2 gap-4">
          {analysis.fit_empresa && (
            <CardShell className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">
                Fit Score — empresa
              </p>
              {analysis.fit_empresa.puntaje != null ? (
                <span
                  className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1 rounded-full"
                  style={{
                    background: scoreColors(analysis.fit_empresa.puntaje, 10).bg,
                    color: scoreColors(analysis.fit_empresa.puntaje, 10).fg,
                  }}
                >
                  {analysis.fit_empresa.puntaje}/10
                </span>
              ) : (
                <span className="inline-flex items-center text-sm font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-500">
                  Sin ICP cargado
                </span>
              )}
              {analysis.fit_empresa.justificacion && (
                <p className="text-sm text-gray-600 mt-3 leading-relaxed">{analysis.fit_empresa.justificacion}</p>
              )}
            </CardShell>
          )}
          {analysis.fit_contacto && (
            <CardShell className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">
                Fit Score — contacto
              </p>
              {analysis.fit_contacto.puntaje != null ? (
                <span
                  className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1 rounded-full"
                  style={{
                    background: scoreColors(analysis.fit_contacto.puntaje, 10).bg,
                    color: scoreColors(analysis.fit_contacto.puntaje, 10).fg,
                  }}
                >
                  {analysis.fit_contacto.puntaje}/10
                </span>
              ) : (
                <span className="inline-flex items-center text-sm font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-500">
                  Sin ICP cargado
                </span>
              )}
              {analysis.fit_contacto.justificacion && (
                <p className="text-sm text-gray-600 mt-3 leading-relaxed">{analysis.fit_contacto.justificacion}</p>
              )}
            </CardShell>
          )}
        </div>
      )}

      {analysis.apuntes_clave?.resumen_general && (
        <CardShell className="p-5">
          <SectionHeading>Resumen general</SectionHeading>
          <p className="text-sm text-gray-700 leading-relaxed">{analysis.apuntes_clave.resumen_general}</p>
        </CardShell>
      )}

      {analysis.metricas_desempeno_ejecutivo && (
        <CardShell className="p-5">
          <SectionHeading>Desempeño del ejecutivo</SectionHeading>
          <div className="space-y-2">
            {Object.entries(analysis.metricas_desempeno_ejecutivo).map(([key, metric]) => {
              const colors = scoreColors(metric?.puntaje, 5);
              return (
                <div key={key} className="flex items-start gap-3 border border-gray-100 rounded-xl px-3.5 py-3">
                  <span className="text-xs font-semibold text-gray-900 w-40 shrink-0 pt-0.5">
                    {METRIC_LABEL[key] ?? key}
                  </span>
                  <span
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: colors.bg, color: colors.fg }}
                  >
                    {metric?.puntaje ?? "—"}
                  </span>
                  <span className="text-xs text-gray-500 leading-relaxed">{metric?.comentario}</span>
                </div>
              );
            })}
          </div>
        </CardShell>
      )}

      {!!analysis.desempeno_vendedor?.oportunidades_mejora?.length && (
        <CardShell className="p-5">
          <SectionHeading>Oportunidades de mejora</SectionHeading>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {analysis.desempeno_vendedor.oportunidades_mejora.map((o, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-4">
                <span
                  className="inline-flex w-7 h-7 rounded-lg items-center justify-center mb-2.5"
                  style={{ background: "rgba(37,23,98,0.08)", color: "#251762" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M13 2L3 14h7l-1 8 10-12h-7z" />
                  </svg>
                </span>
                <p className="text-sm font-semibold text-gray-900 mb-1">{o.area}</p>
                {o.sugerencia && <p className="text-xs text-gray-500 leading-relaxed">{o.sugerencia}</p>}
              </div>
            ))}
          </div>
        </CardShell>
      )}

      {(!!analysis.objeciones?.length || !!analysis.dolores_cliente?.length) && (
        <div className="grid md:grid-cols-2 gap-4">
          {!!analysis.objeciones?.length && (
            <CardShell className="p-5">
              <SectionHeading>Objeciones</SectionHeading>
              <TagList
                dotColor="#B4740E"
                items={analysis.objeciones.map((o) => ({ title: o.tipo ?? "", body: o.contexto }))}
              />
            </CardShell>
          )}
          {!!analysis.dolores_cliente?.length && (
            <CardShell className="p-5">
              <SectionHeading>Dolores del cliente</SectionHeading>
              <TagList
                dotColor="#C0392B"
                items={analysis.dolores_cliente.map((d) => ({ title: d.dolor ?? "", body: d.contexto }))}
              />
            </CardShell>
          )}
        </div>
      )}

      {!!analysis.compromisos?.length && (
        <CardShell className="p-5">
          <SectionHeading>Compromisos</SectionHeading>
          <div className="space-y-2">
            {analysis.compromisos.map((c, i) => (
              <div key={i} className="flex items-start gap-3 border border-gray-100 rounded-xl px-3.5 py-3">
                <span
                  className="w-[19px] h-[19px] rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5"
                  style={
                    c.completado
                      ? { background: "#62E0D8", borderColor: "#62E0D8" }
                      : { borderColor: "#C7C2D6" }
                  }
                >
                  {c.completado && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#251762" strokeWidth="3">
                      <path d="M4 12l5 5L20 6" />
                    </svg>
                  )}
                </span>
                <span className={`text-sm leading-relaxed ${c.completado ? "text-gray-400 line-through" : "text-gray-700"}`}>
                  {c.descripcion}
                </span>
              </div>
            ))}
          </div>
        </CardShell>
      )}

      {!!analysis.temas_pendientes?.length && (
        <CardShell className="p-5">
          <SectionHeading>Temas pendientes</SectionHeading>
          <div className="space-y-3">
            {analysis.temas_pendientes.map((t, i) => (
              <div key={i} className="border border-gray-100 rounded-xl px-4 py-3.5">
                <p className="text-sm font-semibold text-gray-900 mb-1.5">{t.pregunta}</p>
                {t.respuesta_sugerida && (
                  <p className="text-xs text-gray-500 leading-relaxed border-l-2 pl-3" style={{ borderColor: "#62E0D8" }}>
                    <span className="font-semibold" style={{ color: "#0E7A73" }}>
                      Sugerencia:
                    </span>{" "}
                    {t.respuesta_sugerida}
                  </p>
                )}
              </div>
            ))}
          </div>
        </CardShell>
      )}

      {!!analysis.recomendaciones_proximos_pasos?.length && (
        <CardShell className="p-5">
          <SectionHeading>Recomendaciones — próximos pasos</SectionHeading>
          <div className="space-y-2.5">
            {analysis.recomendaciones_proximos_pasos.map((r, i) => (
              <div key={i} className="flex gap-3 border border-gray-100 rounded-xl px-4 py-3.5">
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                  style={{ background: "#251762" }}
                >
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-0.5">{r.titulo}</p>
                  {r.detalle && <p className="text-xs text-gray-500 leading-relaxed">{r.detalle}</p>}
                </div>
              </div>
            ))}
          </div>
        </CardShell>
      )}
    </div>
  );
}
