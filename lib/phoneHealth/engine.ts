// Alertas de Números (salud telefónica proactiva).
//
// Reglas puras (sin I/O) para detectar números de Allo que están cayendo en
// spam o perdiendo conectividad ANTES de que el equipo lo note. Se evalúa
// cada número contra SU PROPIO historial, no contra un umbral fijo: un número
// de México y uno de Chile tienen niveles normales distintos, y lo que
// importa es la caída.
//
// Métrica base: % de llamadas que contesta una persona = etapa
// "Conversación" del embudo de Allo (excluye buzón de voz). Ventanas
// móviles que terminan AYER (día de Chile):
//   - actual:   últimos 7 días
//   - anterior: los 7 días previos a la actual
//   - base:     los 28 días previos a la actual (promedio de referencia)
//
// Validado contra los datos de ago–oct 2026: estas reglas habrían marcado
// Crossnet Argentina y Grupo Tress MX semanas antes de que llegaran a 3–4%.

export type WindowStats = {
  dials: number;
  human: number;       // contesta una persona (etapa Conversación de Allo)
  voicemail: number;   // resultado VOICEMAIL
  short: number;       // "contestada" sin conversación y < 15 s: posible corte / no se oye
};

export type NumberInput = {
  number: string;
  name: string;
  client: string;
  country: string;
  current: WindowStats;
  previous: WindowStats;
  baseline: WindowStats;
};

export type AlertLevel = "red" | "yellow" | "watch" | "ok" | "low_volume";

export type NumberHealth = {
  number: string;
  name: string;
  client: string;
  country: string;
  level: AlertLevel;
  reasons: string[];      // en español, para la pantalla y el correo
  action: string;         // acción sugerida
  dials7: number;
  rate7: number | null;   // % contesta persona, últimos 7 días
  ratePrev7: number | null;
  rateBase: number | null;
  dropPct: number | null; // caída relativa vs base (positivo = cayó)
  voicemailShare7: number | null;
  shortShare7: number | null;
  shortShareBase: number | null;
};

// Umbrales (documentados en CLAUDE.md → "Alertas de Números").
export const THRESHOLDS = {
  minCallsWindow: 50,      // mínimo de llamadas en 7 días para evaluar
  minCallsBaseline: 100,   // mínimo en la base de 28 días para comparar
  redRate: 5,              // % bajo el cual un número está "muerto"
  redDrop: 40,             // % de caída vs base → rojo
  yellowDrop: 25,          // % de caída vs base → amarillo
  voicemailShare: 60,      // % de llamadas a buzón → amarillo
  shortShare: 30,          // % de conexiones cortas → amarillo…
  shortShareRise: 10,      // …si además subió esta cantidad de puntos vs base
  highVolume: 400,         // llamadas en 7 días → vigilar (riesgo de spam por volumen)
};

const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);
const fmt = (n: number | null) => (n === null ? "—" : `${n.toFixed(1).replace(".", ",")}%`);

export function evaluateNumber(n: NumberInput): NumberHealth {
  const T = THRESHOLDS;
  const rate7 = pct(n.current.human, n.current.dials);
  const ratePrev7 = pct(n.previous.human, n.previous.dials);
  const rateBase = pct(n.baseline.human, n.baseline.dials);
  const voicemailShare7 = pct(n.current.voicemail, n.current.dials);
  const shortShare7 = pct(n.current.short, n.current.human + n.current.short);
  const shortShareBase = pct(n.baseline.short, n.baseline.human + n.baseline.short);

  const hasBase = n.baseline.dials >= T.minCallsBaseline && rateBase !== null && rateBase > 0;
  const dropPct = hasBase && rate7 !== null ? ((rateBase! - rate7) / rateBase!) * 100 : null;

  const base: Omit<NumberHealth, "level" | "reasons" | "action"> = {
    number: n.number, name: n.name, client: n.client, country: n.country,
    dials7: n.current.dials, rate7, ratePrev7, rateBase, dropPct, voicemailShare7, shortShare7, shortShareBase,
  };

  if (n.current.dials < T.minCallsWindow) {
    return { ...base, level: "low_volume", reasons: [`Solo ${n.current.dials} llamadas en 7 días (mínimo ${T.minCallsWindow} para evaluar)`], action: "Sin acción" };
  }

  const red: string[] = [];
  const yellow: string[] = [];
  const watch: string[] = [];

  const prevEnough = n.previous.dials >= T.minCallsWindow;
  if (rate7 !== null && rate7 < T.redRate && prevEnough && ratePrev7 !== null && ratePrev7 < T.redRate) {
    red.push(`Bajo ${T.redRate}% dos semanas seguidas (${fmt(ratePrev7)} → ${fmt(rate7)})`);
  }
  if (dropPct !== null && dropPct >= T.redDrop) {
    red.push(`Cayó ${Math.round(dropPct)}% vs su promedio de 4 semanas (${fmt(rateBase)} → ${fmt(rate7)})`);
  } else if (dropPct !== null && dropPct >= T.yellowDrop) {
    yellow.push(`Cayó ${Math.round(dropPct)}% vs su promedio de 4 semanas (${fmt(rateBase)} → ${fmt(rate7)})`);
  }
  if (rate7 !== null && rate7 < T.redRate && red.length === 0) {
    yellow.push(`Contesta una persona solo el ${fmt(rate7)} esta semana`);
  }
  if (voicemailShare7 !== null && voicemailShare7 > T.voicemailShare) {
    yellow.push(`${fmt(voicemailShare7)} de las llamadas termina en buzón`);
  }
  if (
    shortShare7 !== null && shortShare7 >= T.shortShare &&
    (shortShareBase === null || shortShare7 - shortShareBase >= T.shortShareRise)
  ) {
    yellow.push(`Suben las conexiones de menos de 15 s: ${fmt(shortShare7)} (base ${fmt(shortShareBase)}) — posibles cortes o "no se oye"`);
  }
  if (n.current.dials >= T.highVolume) {
    watch.push(`Alto volumen: ${n.current.dials} llamadas en 7 días; programar rotación preventiva`);
  }

  if (red.length) {
    return { ...base, level: "red", reasons: [...red, ...yellow], action: "Reemplazar el número esta semana" };
  }
  if (yellow.length) {
    return { ...base, level: "yellow", reasons: yellow, action: "Revisar: llamada de prueba a operadoras y escuchar grabaciones" };
  }
  if (watch.length) {
    return { ...base, level: "watch", reasons: watch, action: "Vigilar y planificar rotación" };
  }
  return { ...base, level: "ok", reasons: [], action: "Sin acción" };
}

export const LEVEL_ORDER: Record<AlertLevel, number> = { red: 0, yellow: 1, watch: 2, ok: 3, low_volume: 4 };
export const LEVEL_LABEL: Record<AlertLevel, string> = {
  red: "Rojo",
  yellow: "Amarillo",
  watch: "Vigilar",
  ok: "Sano",
  low_volume: "Sin volumen",
};

export function sortHealth(list: NumberHealth[]): NumberHealth[] {
  return [...list].sort(
    (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (a.rate7 ?? 999) - (b.rate7 ?? 999)
  );
}

export function formatPct(n: number | null): string {
  return fmt(n);
}
