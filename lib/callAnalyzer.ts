// Analizador de llamadas con Claude. Sprint 5 fase 2.
//
// Toma la transcripción (o las notas del SDR si no hay transcripción) y
// devuelve un análisis estructurado:
//   1) Respuesta del cliente: categoría estable + resumen 1-2 frases.
//   2) Evaluación del SDR: score global + sub-scores (apertura, descubrimiento,
//      manejo de objeciones, próximo paso) + fortalezas + oportunidades de
//      mejora con citas del transcript.
//   3) Recomendación de próximo paso concreto.
//
// Output en español (cliente hispanohablante). Las keys de category quedan
// en inglés/snake_case porque las usamos para agregar en reportería.

import { createMessageWithFallback } from "./claude";

export type CustomerResponseCategory =
  | "interested"
  | "objection_price"
  | "objection_timing"
  | "objection_no_need"
  | "objection_existing_solution"
  | "objection_authority"
  | "callback_requested"
  | "not_interested"
  | "no_engagement"
  | "voicemail"
  | "wrong_number"
  | "gatekeeper"
  | "other";

// Categorías donde el contacto ATENDIÓ y hubo conversación (aunque no haya
// estado interesado). Se usan para calcular pickup rate.
export const PICKUP_CATEGORIES: ReadonlySet<CustomerResponseCategory> = new Set([
  "interested",
  "objection_price",
  "objection_timing",
  "objection_no_need",
  "objection_existing_solution",
  "objection_authority",
  "callback_requested",
  "not_interested",
  "no_engagement"
]);

// Categorías donde NO hubo pickup del decision maker (buzón, gatekeeper,
// número equivocado). Cuentan en el denominador como "intento" pero no
// suman al numerador de pickup.
export const NO_PICKUP_CATEGORIES: ReadonlySet<CustomerResponseCategory> = new Set([
  "voicemail",
  "gatekeeper",
  "wrong_number"
]);

export const CUSTOMER_RESPONSE_LABELS: Record<CustomerResponseCategory, string> = {
  interested: "Interesado",
  objection_price: "Objeción · Precio",
  objection_timing: "Objeción · Timing",
  objection_no_need: "Objeción · No lo necesita",
  objection_existing_solution: "Objeción · Ya tiene solución",
  objection_authority: "Objeción · No decide",
  callback_requested: "Pidió callback",
  not_interested: "No interesado",
  no_engagement: "Sin engagement",
  voicemail: "Buzón de voz",
  wrong_number: "Número equivocado",
  gatekeeper: "Filtrado por gatekeeper",
  other: "Otro"
};

export type CallAnalysisInput = {
  // Contexto de quién/dónde
  contact_name: string | null;
  contact_title: string | null;
  company_name: string | null;
  company_type: string | null;
  company_size: number | null;
  cad_software: string | null;
  // SDR
  sdr_name: string | null;
  // Datos de la llamada
  direction: string | null;       // INBOUND / OUTBOUND
  duration_sec: number | null;
  disposition_label: string | null;
  status: string | null;
  // Contenido
  transcription: string | null;
  notes: string | null;
};

export type SdrImprovement = {
  area: string;
  suggestion: string;
  example_quote: string | null;
};

export type CallAnalysis = {
  customer_response: {
    category: CustomerResponseCategory;
    label: string;
    summary: string;
  };
  sdr_evaluation: {
    overall_score: number;
    opening: number;
    discovery: number;
    objection_handling: number;
    next_step: number;
    strengths: string[];
    improvements: SdrImprovement[];
  };
  recommended_next_step: string;
  model_used: string;
};

const SYSTEM_PROMPT = `Eres coach de SDR para weCAD4you, un servicio B2B que diseña restauraciones dentales CAD/CAM (coronas, puentes, carillas) en exocad e inLab con entrega en 24h (6h rush). Clientes target: laboratorios dentales, grupos multi-clínica y DSOs que ya usan workflow digital pero no tienen capacidad de diseño CAD/CAM interna.

Tu trabajo es analizar una llamada outbound del SDR a un prospecto y devolver:
1. Cómo respondió el cliente (categoría + resumen).
2. Evaluación de qué tan bien lo hizo el SDR (scores 0-10 + fortalezas + oportunidades de mejora con citas).
3. Próximo paso recomendado concreto.

Sé directo y honesto: si la llamada salió mal, dilo. Si el SDR cometió errores específicos, señálalos con citas textuales. Si no hay transcripción y solo notas, indícalo en las limitaciones del análisis.

Responde SIEMPRE en español rioplatense (tono profesional pero cercano). Devuelve JSON estricto, sin prosa alrededor.`;

function buildUserPrompt(input: CallAnalysisInput): string {
  const lines: string[] = [];
  lines.push(`CONTEXTO DEL PROSPECTO:`);
  lines.push(`- Nombre: ${input.contact_name ?? "(desconocido)"}`);
  lines.push(`- Cargo: ${input.contact_title ?? "(desconocido)"}`);
  lines.push(`- Empresa: ${input.company_name ?? "(desconocido)"}`);
  if (input.company_type) lines.push(`- Tipo: ${input.company_type}`);
  if (input.company_size != null) lines.push(`- Tamaño: ${input.company_size} empleados`);
  if (input.cad_software) lines.push(`- Software CAD: ${input.cad_software}`);
  lines.push(``);
  lines.push(`DATOS DE LA LLAMADA:`);
  if (input.sdr_name) lines.push(`- SDR: ${input.sdr_name}`);
  if (input.direction) lines.push(`- Dirección: ${input.direction}`);
  if (input.duration_sec != null) lines.push(`- Duración: ${input.duration_sec}s`);
  if (input.disposition_label) lines.push(`- Outcome (HubSpot): ${input.disposition_label}`);
  if (input.status) lines.push(`- Estado: ${input.status}`);
  lines.push(``);
  if (input.transcription && input.transcription.trim()) {
    lines.push(`TRANSCRIPCIÓN:`);
    lines.push(input.transcription.trim().slice(0, 16000));
    lines.push(``);
  }
  if (input.notes && input.notes.trim()) {
    lines.push(`NOTAS DEL SDR (escritas a mano):`);
    lines.push(input.notes.trim().slice(0, 4000));
    lines.push(``);
  }
  if (
    (!input.transcription || !input.transcription.trim()) &&
    (!input.notes || !input.notes.trim())
  ) {
    lines.push(`(No hay transcripción ni notas. Analizá solo con metadata.)`);
    lines.push(``);
  }

  lines.push(`Devolvé este JSON exacto (sin texto extra ni fences):`);
  lines.push(`{`);
  lines.push(`  "customer_response": {`);
  lines.push(`    "category": "<una de: interested | objection_price | objection_timing | objection_no_need | objection_existing_solution | objection_authority | callback_requested | not_interested | no_engagement | voicemail | wrong_number | gatekeeper | other>",`);
  lines.push(`    "summary": "<1-2 frases en español describiendo cómo respondió el cliente>"`);
  lines.push(`  },`);
  lines.push(`  "sdr_evaluation": {`);
  lines.push(`    "overall_score": <0-10, decimal permitido>,`);
  lines.push(`    "opening": <0-10>,`);
  lines.push(`    "discovery": <0-10>,`);
  lines.push(`    "objection_handling": <0-10, o 0 si no hubo objeciones a manejar>,`);
  lines.push(`    "next_step": <0-10>,`);
  lines.push(`    "strengths": ["<fortaleza específica 1>", "<fortaleza 2>"],`);
  lines.push(`    "improvements": [`);
  lines.push(`      { "area": "<área, ej. 'Apertura' / 'Descubrimiento' / 'Manejo de objeción'>",`);
  lines.push(`        "suggestion": "<sugerencia concreta y accionable>",`);
  lines.push(`        "example_quote": "<cita textual del transcript que muestra el problema, o null si no hay transcript>" }`);
  lines.push(`    ]`);
  lines.push(`  },`);
  lines.push(`  "recommended_next_step": "<acción concreta para el SDR: agendar callback, enviar email con caso, descalificar, etc.>"`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`Reglas:`);
  lines.push(`- Los scores deben reflejar la calidad real. NO inflar. Si fue voicemail o gatekeeper sin diálogo real, opening/discovery/objection/next_step = 0 y overall_score refleja solo si el SDR dejó un buen mensaje.`);
  lines.push(`- strengths: máximo 3, específicas, citables. Si no hay nada destacable, devolver array vacío.`);
  lines.push(`- improvements: 1 a 4 ítems, accionables. Si no hay transcript, example_quote = null y la suggestion debe basarse en las notas o ser genérica al outcome.`);
  lines.push(`- recommended_next_step: una sola acción concreta, no una lista.`);
  return lines.join("\n");
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(body);
}

function clamp(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, Math.round(v * 10) / 10));
}

function normalizeCategory(c: unknown): CustomerResponseCategory {
  const s = String(c ?? "").toLowerCase().trim();
  if (s in CUSTOMER_RESPONSE_LABELS) return s as CustomerResponseCategory;
  return "other";
}

export async function analyzeCall(input: CallAnalysisInput): Promise<CallAnalysis> {
  const { message, model_used } = await createMessageWithFallback({
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }]
  });

  const block = message.content.find((c) => c.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Claude no devolvió texto");
  }
  const parsed = extractJson(block.text) as {
    customer_response?: { category?: string; summary?: string };
    sdr_evaluation?: {
      overall_score?: number;
      opening?: number;
      discovery?: number;
      objection_handling?: number;
      next_step?: number;
      strengths?: string[];
      improvements?: Array<{ area?: string; suggestion?: string; example_quote?: string | null }>;
    };
    recommended_next_step?: string;
  };

  const category = normalizeCategory(parsed.customer_response?.category);
  const improvements: SdrImprovement[] = Array.isArray(parsed.sdr_evaluation?.improvements)
    ? parsed.sdr_evaluation!.improvements!
        .filter((i) => i && (i.area || i.suggestion))
        .slice(0, 4)
        .map((i) => ({
          area: (i.area ?? "").toString().trim() || "General",
          suggestion: (i.suggestion ?? "").toString().trim(),
          example_quote:
            i.example_quote == null || i.example_quote === ""
              ? null
              : String(i.example_quote).trim().slice(0, 600)
        }))
    : [];
  const strengths = Array.isArray(parsed.sdr_evaluation?.strengths)
    ? parsed.sdr_evaluation!.strengths!
        .filter((s) => typeof s === "string" && s.trim())
        .slice(0, 3)
        .map((s) => s.trim())
    : [];

  return {
    customer_response: {
      category,
      label: CUSTOMER_RESPONSE_LABELS[category],
      summary: (parsed.customer_response?.summary ?? "").toString().trim()
    },
    sdr_evaluation: {
      overall_score: clamp(parsed.sdr_evaluation?.overall_score),
      opening: clamp(parsed.sdr_evaluation?.opening),
      discovery: clamp(parsed.sdr_evaluation?.discovery),
      objection_handling: clamp(parsed.sdr_evaluation?.objection_handling),
      next_step: clamp(parsed.sdr_evaluation?.next_step),
      strengths,
      improvements
    },
    recommended_next_step: (parsed.recommended_next_step ?? "").toString().trim(),
    model_used
  };
}
