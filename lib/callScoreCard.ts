// Parsea el "Score de Desempeño SDR" que Allo genera con IA dentro del
// campo `summary` de una llamada (texto Markdown con un formato fijo,
// personalizado por BullsEye en el prompt de Allo — confirmado inspeccionando
// llamadas reales). No todas las llamadas tienen este análisis completo (en
// una muestra de 500 llamadas recientes, solo ~28 lo traían — la mayoría solo
// tiene un resumen corto de una línea), así que parseCallScoreCard devuelve
// null cuando no encuentra "PUNTAJE TOTAL" en el texto.
//
// Sin dependencias de Node/env a propósito: se importa tanto desde rutas de
// servidor como desde componentes de cliente (columna "Score" en /llamadas).

export type ScoreCardCategory = {
  label: string;
  max: number;
  score: number | null; // null = la llamada no tuvo ese ítem (ej. "Manejo de Objeciones: N/A" si no hubo objeciones)
};

export type CallScoreCard = {
  puntajeTotal: number; // sobre 100
  nivel: string | null;
  desglose: ScoreCardCategory[];
  fortalezaPrincipal: string | null;
  oportunidadMejora: string | null;
  coaching: string | null;
};

// Orden y máximo fijos del DESGLOSE tal como lo genera el prompt de Allo.
export const SCORE_CARD_CATEGORIES: { label: string; max: number }[] = [
  { label: "Apertura y Contexto", max: 15 },
  { label: "Permiso y Engagement", max: 10 },
  { label: "Discovery y Contexto", max: 20 },
  { label: "Escucha Activa y Conversación", max: 10 },
  { label: "Propuesta de Valor y Relevancia", max: 15 },
  { label: "Manejo de Objeciones", max: 15 },
  { label: "Cierre y Siguiente Paso", max: 10 },
  { label: "Calidad de Comunicación", max: 5 },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseCallScoreCard(summary: string | null | undefined): CallScoreCard | null {
  if (!summary) return null;

  const totalMatch = summary.match(/PUNTAJE TOTAL:\s*(\d+)\s*\/\s*100/i);
  if (!totalMatch) return null;

  const nivelMatch = summary.match(/NIVEL:\s*\n?\s*([^\n]+)/i);

  const desglose: ScoreCardCategory[] = SCORE_CARD_CATEGORIES.map(({ label, max }) => {
    const re = new RegExp(`${escapeRegex(label)}:\\s*(\\d+)\\s*/\\s*\\d+`, "i");
    const m = summary.match(re);
    return { label, max, score: m ? Number(m[1]) : null };
  });

  const fortalezaMatch = summary.match(
    /FORTALEZA PRINCIPAL:\s*\n?\s*-?\s*([\s\S]*?)(?:\n\s*\n|PRINCIPAL OPORTUNIDAD DE MEJORA:)/i
  );
  const oportunidadMatch = summary.match(
    /PRINCIPAL OPORTUNIDAD DE MEJORA:\s*\n?\s*-?\s*([\s\S]*?)(?:\n\s*\n|COACHING PARA LA PRÓXIMA LLAMADA:)/i
  );
  const coachingMatch = summary.match(/COACHING PARA LA PRÓXIMA LLAMADA:\s*\n?\s*-?\s*([\s\S]*)$/i);

  return {
    puntajeTotal: Number(totalMatch[1]),
    nivel: nivelMatch ? nivelMatch[1].trim() : null,
    desglose,
    fortalezaPrincipal: fortalezaMatch ? fortalezaMatch[1].trim() : null,
    oportunidadMejora: oportunidadMatch ? oportunidadMatch[1].trim() : null,
    coaching: coachingMatch ? coachingMatch[1].trim() : null,
  };
}
