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
  max: number; // siempre NORMALIZED_MAX (5) — ver más abajo
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

// Escala objetivo a la que se normaliza cada ítem del DESGLOSE. El prompt de
// Allo cambió de escalas variables por ítem (15/10/20/10/15/15/10/5) a 1-5
// parejo para todos — pero las llamadas analizadas ANTES del cambio quedaron
// grabadas con su texto en la escala vieja (ej. "Apertura y Contexto: 11/15"),
// y ese texto no se vuelve a generar. Por eso el score de cada ítem se lee
// junto con su propio denominador (no se asume un máximo fijo) y se
// reescala a /5, para poder promediar y comparar llamadas de antes y
// después del cambio en una sola columna. También corrige el caso en que la
// IA se pasa de su propio máximo (ej. "Calidad de Comunicación: 6/5") —
// normalizar y acotar a 5 evita mostrar una nota "mayor que el máximo".
const NORMALIZED_MAX = 5;

export const SCORE_CARD_CATEGORIES: { label: string; max: number }[] = [
  { label: "Apertura y Contexto", max: NORMALIZED_MAX },
  { label: "Permiso y Engagement", max: NORMALIZED_MAX },
  { label: "Discovery y Contexto", max: NORMALIZED_MAX },
  { label: "Escucha Activa y Conversación", max: NORMALIZED_MAX },
  { label: "Propuesta de Valor y Relevancia", max: NORMALIZED_MAX },
  { label: "Manejo de Objeciones", max: NORMALIZED_MAX },
  { label: "Cierre y Siguiente Paso", max: NORMALIZED_MAX },
  { label: "Calidad de Comunicación", max: NORMALIZED_MAX },
];

// Colores compartidos por toda la UI que muestra estos puntajes (columna
// "Score" en /llamadas, Score de Llamadas IA en Análisis SDR y su detalle
// por llamada), para que el mismo puntaje se vea igual en todas partes. Se
// redondea antes de clasificar para que el color siempre corresponda al
// número que efectivamente se muestra (evita, ej., un 79.6 mostrado como
// "80" pero coloreado como amarillo).
export type ScoreColor = { bg: string; fg: string };

const SCORE_COLOR_GREEN: ScoreColor = { bg: "#DCFCE7", fg: "#15803D" };
const SCORE_COLOR_YELLOW: ScoreColor = { bg: "#FEF9C3", fg: "#A16207" };
const SCORE_COLOR_RED: ScoreColor = { bg: "#FEE2E2", fg: "#B91C1C" };

// Puntaje Total, sobre 100: 80-100 verde, 60-79 amarillo, 59 o menos rojo.
export function scoreColor100(value: number): ScoreColor {
  const rounded = Math.round(value);
  if (rounded >= 80) return SCORE_COLOR_GREEN;
  if (rounded >= 60) return SCORE_COLOR_YELLOW;
  return SCORE_COLOR_RED;
}

// Ítems del DESGLOSE, normalizados a /5: 5 verde, 3-4 amarillo, 1-2 rojo.
export function scoreColor5(value: number): ScoreColor {
  const rounded = Math.round(value);
  if (rounded >= 5) return SCORE_COLOR_GREEN;
  if (rounded >= 3) return SCORE_COLOR_YELLOW;
  return SCORE_COLOR_RED;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseCallScoreCard(summary: string | null | undefined): CallScoreCard | null {
  if (!summary) return null;

  const totalMatch = summary.match(/PUNTAJE TOTAL:\s*(\d+)\s*\/\s*100/i);
  if (!totalMatch) return null;

  const nivelMatch = summary.match(/NIVEL:\s*\n?\s*([^\n]+)/i);

  const desglose: ScoreCardCategory[] = SCORE_CARD_CATEGORIES.map(({ label }) => {
    const re = new RegExp(`${escapeRegex(label)}:\\s*(\\d+(?:\\.\\d+)?)\\s*/\\s*(\\d+(?:\\.\\d+)?)`, "i");
    const m = summary.match(re);
    if (!m) return { label, max: NORMALIZED_MAX, score: null };
    const rawScore = Number(m[1]);
    const rawMax = Number(m[2]);
    const normalized = rawMax > 0 ? Math.min((rawScore / rawMax) * NORMALIZED_MAX, NORMALIZED_MAX) : null;
    return { label, max: NORMALIZED_MAX, score: normalized };
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
