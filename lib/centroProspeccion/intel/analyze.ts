import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/claude";
import { logAiUsage } from "@/lib/aiUsageLogger";
import type { IntelNumbers } from "./numbers";

// Inteligencia de la semana — análisis con IA (mismo patrón que
// lib/alloCallSignals.ts: herramienta con esquema fijo, reglas para no
// inventar, uso registrado en ai_usage_log). Junta por cliente:
//  - los números de la cuenta (Pulso ABM),
//  - las señales ya extraídas de las llamadas de Allo (allo_call_signals),
//  - lo que los SDR escribieron en HubSpot (resúmenes de llamadas, notas),
//  - minutas de reuniones con el cliente (diio),
//  - los rechazos del cliente y el feedback de reuniones,
//  - la ficha del Centro (cargos, industrias, exclusiones vigentes),
// y propone cuánto y dónde prospectar y qué cambiar en la ficha.

export const INTEL_FUNCTION = "centro_inteligencia_semanal";

export type IntelProposal = {
  id: string;
  tipo: "cargo_sumar" | "cargo_sacar" | "industria_priorizar" | "industria_descartar" | "exclusion" | "zona" | "mensaje" | "otro";
  campo: "cargos" | "industrias" | "exclusiones" | "zonas" | "proximos";
  texto: string;          // lo que se escribiría en la ficha
  evidencia: string;      // por qué (con conteos)
  casos: number;
  toca_icp: boolean;      // cambia el ICP del cliente: validar con el KAM
  estado?: "pendiente" | "aprobada" | "descartada";
  decidido_por?: string;
  decidido_at?: string;
};
export type IntelReminder = { empresa: string; contacto: string; cuando: string; motivo: string; sdr: string };
export type IntelResult = {
  resumen: string;
  prioridad: "alta" | "media" | "baja";
  empresas_sugeridas: number;
  motivo_cantidad: string;
  donde_prospectar: string[];
  propuestas: IntelProposal[];
  recordatorios: IntelReminder[];
  calidad_datos: string[];
  minuta: string;         // novedades de reuniones con el cliente (diio), si hubo
};

const SYSTEM = `Eres el analista de prospección de BullsEye, una agencia de prospección B2B (ABM). Cada semana revisas un cliente de la agencia y propones a la líder de prospección cómo ajustar la prospección de la semana siguiente.

Reglas obligatorias:
- Básate solo en la evidencia entregada (números, señales de llamadas, notas de SDR, rechazos, feedback). Nunca inventes empresas, cargos, cifras ni fechas.
- Una propuesta de cambio exige un patrón: al menos 3 casos independientes (o 2 si son rechazos explícitos del cliente). Indica el número de casos y resume la evidencia con conteos.
- No repitas lo que la ficha ya dice. Si algo ya está en la ficha, no lo propongas de nuevo.
- Cargos: "cargo_sumar" cuando los contactos derivan repetidamente a un cargo que no estamos buscando; "cargo_sacar" cuando un cargo repetidamente dice que no decide o no es su área.
- Industrias: priorizar o descartar solo con diferencias claras en los números o con objeciones repetidas.
- Exclusiones: empresas que rechazaron explícitamente, que ya son clientes del cliente o con contratos cerrados largos; nómbralas.
- Recordatorios: solo cuando el prospecto pidió que lo llamen en un momento concreto (ej. "en diciembre", "después del 15"). Usa la fecha tal como se dijo o el mes (AAAA-MM o AAAA-MM-DD).
- Calidad de datos: problemas con los contactos entregados por prospección (números de central, números malos, personas que ya no trabajan, cargos equivocados), con conteos.
- empresas_sugeridas: cuántas empresas nuevas debería prospectar el equipo la próxima semana para este cliente. Combina dos cosas:
  1) La meta de reuniones del mes (<meta_reuniones>): si la meta ya está cumplida, baja el ritmo (máximo 10) y prioridad baja. Si faltan reuniones y quedan pocos días hábiles, sube la prioridad. Proyecta cuántas empresas hacen falta con la conversión histórica de la cuenta (reuniones de los últimos 30 días frente a las empresas y contactos trabajados en <numeros>); si no hay conversión medible, dilo y usa el stock. Ten presente que lo que se prospecta hoy suele convertirse en reuniones en 2 a 4 semanas: en la segunda mitad del mes, prospectar alimenta sobre todo el mes siguiente.
  2) El stock de los SDR: si tienen contactos para más de 15 días hábiles, sugiere poco (0–10) aunque falten reuniones (el problema no es de prospección); si tienen menos de 5 días, sugiere más (30–60).
  Explica el cálculo en motivo_cantidad con las cifras (meta, realizadas, faltan, días hábiles, stock).
- No incluyas correos, teléfonos ni datos personales de prospectos. Nombres de empresa sí; de personas solo el cargo.
- Español de Chile, frases cortas y claras.`;

const TOOL: Anthropic.Tool = {
  name: "proponer_inteligencia_semanal",
  description: "Propuesta semanal de prospección para un cliente",
  input_schema: {
    type: "object",
    properties: {
      resumen: { type: "string", description: "2 o 3 frases: cómo va la cuenta y qué hacer la próxima semana" },
      prioridad: { type: "string", enum: ["alta", "media", "baja"], description: "Urgencia de prospectar para este cliente" },
      empresas_sugeridas: { type: "integer", description: "Empresas nuevas a prospectar la próxima semana (0–80)" },
      motivo_cantidad: { type: "string" },
      donde_prospectar: { type: "array", items: { type: "string" }, description: "Segmentos concretos a priorizar (industria × cargo × país), máximo 5" },
      propuestas: {
        type: "array",
        description: "Cambios a la ficha con evidencia. Vacío si no hay patrones claros.",
        items: {
          type: "object",
          properties: {
            tipo: { type: "string", enum: ["cargo_sumar", "cargo_sacar", "industria_priorizar", "industria_descartar", "exclusion", "zona", "mensaje", "otro"] },
            campo: { type: "string", enum: ["cargos", "industrias", "exclusiones", "zonas", "proximos"], description: "Campo de la ficha donde se anotaría" },
            texto: { type: "string", description: "Texto breve a agregar en la ficha" },
            evidencia: { type: "string", description: "Por qué, con conteos y ejemplos (sin datos personales)" },
            casos: { type: "integer" },
            toca_icp: { type: "boolean", description: "true si cambia el ICP acordado con el cliente (lo valida el KAM)" },
          },
          required: ["tipo", "campo", "texto", "evidencia", "casos", "toca_icp"],
        },
      },
      recordatorios: {
        type: "array",
        items: {
          type: "object",
          properties: {
            empresa: { type: "string" },
            contacto: { type: "string", description: "Cargo del contacto (no nombre)" },
            cuando: { type: "string", description: "AAAA-MM-DD o AAAA-MM" },
            motivo: { type: "string" },
            sdr: { type: "string", description: "SDR que hizo la llamada, si se conoce" },
          },
          required: ["empresa", "contacto", "cuando", "motivo", "sdr"],
        },
      },
      calidad_datos: { type: "array", items: { type: "string" } },
      minuta: { type: "string", description: "Novedades relevantes de reuniones con el cliente (minutas), o vacío" },
    },
    required: ["resumen", "prioridad", "empresas_sugeridas", "motivo_cantidad", "donde_prospectar", "propuestas", "recordatorios", "calidad_datos", "minuta"],
  },
};

export type IntelInputs = {
  clientId: string;
  cliente: string;
  semana: string;
  numbers: IntelNumbers | null;
  ficha: string;
  icp: string;
  senales: string;
  hubspot: string;
  minutas: string;
  rechazos: string;
  feedback: string;
  meta: string;
};

export async function analyzeWeek(inp: IntelInputs, model: string): Promise<{ result: IntelResult; costIn: number; costOut: number }> {
  const n = inp.numbers;
  const numbersText = n
    ? [
        `Corte del Pulso ABM: ${n.corte ?? "s/i"}. Empresas asignadas: ${n.empresas}. Contactos: ${n.contactos}.`,
        `Contactos sin gestionar (stock de los SDR): ${n.sinGestion}. Ritmo: ${n.ritmoDiario} contactos nuevos por día hábil. Días de stock: ${n.diasStock ?? "sin ritmo medible"}.`,
        `Empresas sin contactos cargados: ${n.empresasSinContacto}. Reuniones últimos 30 días: ${n.reuniones30d} (${n.realizadas30d} realizadas).`,
        `Segmentos con mejor resultado: ${n.mejores.map((s) => `${s.dim} ${s.valor} (${s.trabajados} trabajados, ${s.tasaConexion}% conexión, ${s.tasaReunion}% reunión)`).join("; ") || "sin muestra"}.`,
        `Segmentos con peor resultado: ${n.peores.map((s) => `${s.dim} ${s.valor} (${s.trabajados} trabajados, ${s.tasaConexion}% conexión, ${s.tasaReunion}% reunión)`).join("; ") || "sin muestra"}.`,
      ].join("\n")
    : "Sin números del Pulso ABM.";
  const user = `Cliente: ${inp.cliente}. Semana a planificar: la que empieza el ${inp.semana}.

<numeros>
${numbersText}
</numeros>

<meta_reuniones>
${inp.meta || "Sin meta cargada."}
</meta_reuniones>

<ficha_actual>
${inp.ficha || "Sin ficha."}
</ficha_actual>

<icp_resumen>
${inp.icp.slice(0, 4000) || "Sin ICP."}
</icp_resumen>

<senales_llamadas_allo>
${inp.senales || "Sin señales analizadas esta semana."}
</senales_llamadas_allo>

<hubspot_sdr>
${inp.hubspot || "Sin llamadas ni notas con texto esta semana."}
</hubspot_sdr>

<minutas_cliente>
${inp.minutas || "Sin minutas."}
</minutas_cliente>

<rechazos_del_cliente>
${inp.rechazos || "Sin rechazos."}
</rechazos_del_cliente>

<feedback_reuniones>
${inp.feedback || "Sin feedback."}
</feedback_reuniones>

Usa la herramienta proponer_inteligencia_semanal.`;

  const msg = await anthropic().messages.create({
    model,
    max_tokens: 3000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content: user }],
  });
  void logAiUsage({
    clientId: inp.clientId,
    functionName: INTEL_FUNCTION,
    model,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    metadata: { semana: inp.semana },
  });
  const block = msg.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
  if (!block) throw new Error("La IA no devolvió la propuesta");
  const r = block.input as IntelResult;
  // La IA a veces devuelve una lista como texto (JSON o líneas sueltas) en vez
  // de arreglo: se normaliza para no caerse (nov-2026, CCHC: "slice(...).map
  // is not a function")
  const arr = <T,>(v: unknown): T[] => {
    if (Array.isArray(v)) return v as T[];
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) return [];
      try { const j = JSON.parse(t); if (Array.isArray(j)) return j as T[]; } catch { /* no es JSON */ }
      // A veces llega como pseudo-XML "<item>…</item>" (CCHC, 13-nov-2026):
      // cada item es un texto o, si trae sub-etiquetas, un objeto campo → valor.
      const items = [...t.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1].trim());
      if (items.length) {
        return items.map((it) => {
          const fields = [...it.matchAll(/<([a-z_]+)>([\s\S]*?)<\/\1>/gi)];
          if (!fields.length) return it;
          const o: Record<string, string> = {};
          for (const f of fields) o[f[1]] = f[2].trim();
          return o;
        }) as unknown as T[];
      }
      return t.split(/\n+|;\s+/).map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean) as unknown as T[];
    }
    return [];
  };
  const props = arr<IntelProposal>(r.propuestas).filter((p) => p && typeof p === "object").map((p, i) => ({ ...p, id: `p${i + 1}`, estado: "pendiente" as const }));
  return {
    result: {
      resumen: String(r.resumen ?? ""),
      prioridad: (["alta", "media", "baja"].includes(r.prioridad) ? r.prioridad : "media") as IntelResult["prioridad"],
      empresas_sugeridas: Math.max(0, Math.min(80, Math.round(Number(r.empresas_sugeridas) || 0))),
      motivo_cantidad: String(r.motivo_cantidad ?? ""),
      donde_prospectar: arr<unknown>(r.donde_prospectar).slice(0, 5).map(String),
      propuestas: props,
      recordatorios: arr<IntelReminder>(r.recordatorios).filter((x) => x && typeof x === "object").slice(0, 30),
      calidad_datos: arr<unknown>(r.calidad_datos).slice(0, 10).map(String),
      minuta: String(r.minuta ?? ""),
    },
    costIn: msg.usage.input_tokens,
    costOut: msg.usage.output_tokens,
  };
}
