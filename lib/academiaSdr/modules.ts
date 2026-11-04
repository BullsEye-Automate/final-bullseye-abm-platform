// Los 10 módulos ("vueltas") de la Academia SDR y qué bloques debe traer
// cada uno. Basado en el skill "academia-sdr-bullseye".

export type ModuleDef = {
  no: number;
  title: string;
  instructions: string;
  maxTokens: number;
};

export const MODULES: ModuleDef[] = [
  {
    no: 1,
    title: "Antes de empezar",
    maxTokens: 3000,
    instructions: `Qué aprenderá el SDR en esta academia y cuál es el foco de la campaña (servicio foco, países e industrias de esta fase).
Bloques: "text" (bienvenida y para qué sirve la academia), "facts" (servicio foco, países, industrias prioritarias, meta: reunión de 15 minutos), "bullets" (qué vas a saber hacer al terminar), "callout" tone "tip" (cómo usar la academia: una vuelta por día, quiz final).`,
  },
  {
    no: 2,
    title: "Quién es el cliente",
    maxTokens: 4000,
    instructions: `A qué se dedica el cliente contado como historia problema → solución → resultado, con una analogía de la vida diaria.
Bloques: "story" (problem, solution, result, analogy), "facts" (cifras clave SOLO si están en los materiales: años, países, clientes, equipo…), "bullets" heading "3 razones fáciles de recordar" (exactamente 3), "text" si hace falta contexto adicional.`,
  },
  {
    no: 3,
    title: "Qué vende",
    maxTokens: 6000,
    instructions: `Cada servicio del cliente con analogía, qué significa en la empresa del prospecto y un ejemplo real. Marca focus=true en el servicio foco.
Bloques: "services" (todos los servicios), "steps" heading "Paso a paso del servicio foco" (4 a 7 pasos), "text" heading "Entrar chico y crecer" (estrategia de partir con algo acotado y crecer en la cuenta), "concepts" si hay conceptos técnicos del servicio que explicar.`,
  },
  {
    no: 4,
    title: "Diccionario",
    maxTokens: 5000,
    instructions: `Roles y palabras técnicas del rubro explicadas en simple.
Bloques: "glossary" (12 a 20 términos; cada uno con "simple" = qué significa en simple y "why" = por qué te importa para vender), "callout" tone "tip" heading "Si te hacen una pregunta muy técnica" (qué responder: reconocerlo, no inventar, ofrecer al especialista en la reunión).`,
  },
  {
    no: 5,
    title: "A quién le vendemos",
    maxTokens: 5000,
    instructions: `El ICP en simple, explicado para entender por qué las cuentas están en la lista (NO para descartarlas): la lista llega ya filtrada.
Bloques: "text" (el ICP en simple), "callout" tone "info" heading "Tu lista ya viene filtrada" (el SDR no califica si la empresa compra), "roles" (quién decide / influye / no decide, con qué le preocupa a cada uno), "bullets" heading "Qué le preocupa a quien decide".`,
  },
  {
    no: 6,
    title: "La necesidad",
    maxTokens: 5000,
    instructions: `Los problemas que resuelve el cliente y cómo nombrarlos sin estudiar cada empresa.
Bloques: "needs" (por industria prioritaria o rol: problem + 2 a 3 frases generales que el SDR puede decir tal cual; nunca "Vi que están…" ni datos puntuales de la cuenta), "bullets" heading "Cuándo avisar a tu líder" (en vez de descalificadores: situaciones donde el SDR debe escalar).`,
  },
  {
    no: 7,
    title: "Clientes que puedes mencionar",
    maxTokens: 4000,
    instructions: `Qué caso usar según la industria del prospecto y cómo decirlo en una frase. Usa SOLO clientes que aparezcan en los materiales.
Bloques: "callout" tone "alerta" (usar solo si el cliente autorizó su uso en campaña), "cases" (industry, client, story, oneLiner). Si no hay casos en los materiales, devuelve "cases" vacío, explica en un "text" cómo hablar sin casos y agrega la pregunta en openQuestions.`,
  },
  {
    no: 8,
    title: "Cómo escribir y hablar",
    maxTokens: 8000,
    instructions: `Cómo escribir mensajes y llamar. Mensajes generales sobre el problema típico de la industria o rol, sin depender de investigar la cuenta.
Bloques: "dosdonts" (haz esto / evita esto), "builder" (fórmula de 4 piezas: context = contexto general, help = cómo ayudamos, proof = prueba, question = pregunta de cierre; 3 a 4 opciones cortas por pieza que combinen entre sí), "examples" (3 a 5 mensajes de ejemplo de email y LinkedIn, menos de 80 palabras), "script" heading "Guion telefónico de 30 segundos" (lines con speaker "SDR" / "Prospecto"), "sequence" heading "Secuencia de 15 días" (día 1 a 15 por email, LinkedIn y llamada).`,
  },
  {
    no: 9,
    title: "Cuándo una reunión vale la pena",
    maxTokens: 6000,
    instructions: `Checklist de una buena reunión: quien decide + necesidad confirmada + urgencia.
Bloques: "checklist" (5 a 8 ítems, critical=true en quien decide, necesidad confirmada y urgencia), "questions" heading "Preguntas de descubrimiento" (6 a 10), "objections" (6 a 10 objeciones típicas con meaning = lo que realmente significa y answer = qué responder).`,
  },
  {
    no: 10,
    title: "Tu primera semana",
    maxTokens: 7000,
    instructions: `Plan de 5 días con tareas prácticas y quiz final.
Bloques: "plan" (5 días: day "Día 1"… title y 3 a 5 tasks prácticas), "quiz" (exactamente 10 preguntas de alternativas con 4 opciones, answer = índice 0-3 de la correcta, explain = por qué; sobre lo visto en las vueltas 1 a 9), "callout" tone "tip" (se aprueba con 8 de 10).`,
  },
];

export const MODULE_COUNT = MODULES.length;

export function getModuleDef(no: number): ModuleDef | null {
  return MODULES.find((m) => m.no === no) ?? null;
}
