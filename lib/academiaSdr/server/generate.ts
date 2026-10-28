import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, getClientModel } from "@/lib/claude";
import { logAiUsage } from "@/lib/aiUsageLogger";
import { getModuleDef, MODULES } from "../modules";
import type { AcademyInputs, AcademyModule, AcademyRecord, Block } from "../types";
import { EMPTY_INPUTS, sanitizeInputs } from "../types";

// Generación de la Academia SDR con IA, un módulo por llamada. El contexto
// del cliente (Contexto IA + ICP) va en el system con cache_control, así
// las 10 llamadas comparten el prefijo cacheado.

const MAX_CONTEXT_CHARS = 180_000;

const SYSTEM_RULES = `Actúas como diseñador instruccional de BullsEye (agencia de Account Based Marketing). Creas una capacitación ("Academia SDR") para SDRs sin experiencia, para que entiendan al 100% qué hace el cliente y puedan prospectar sus servicios. La academia tiene 10 módulos ("vueltas", metáfora Fórmula 1); en cada llamada escribes UN módulo.

Fuentes: usa SOLO la información de <contexto_cliente> y de <foco_campana>. No inventes cifras, clientes ni resultados. Si falta un dato, escríbelo de forma general y agrega la duda en openQuestions. Si dos fuentes se contradicen, usa la más conservadora y agrega la contradicción en openQuestions como pregunta abierta para el cliente.

Reglas sobre el rol del SDR:
1. Las cuentas llegan al SDR ya filtradas: ya sabemos que tienen la necesidad. El SDR NO investiga ni califica si la empresa compra. Su trabajo es entender la necesidad, llegar a quien decide y conseguir una reunión de 15 minutos.
2. Los mensajes NO dependen de que el SDR estudie cada empresa. Nada de "Vi que están buscando…" ni datos puntuales de la cuenta. Usa frases generales sobre el problema típico de la industria o del rol del contacto.
3. El ICP se explica para entender por qué las cuentas están en la lista, no para descartarlas.
4. En vez de descalificadores, usa "Cuándo avisar a tu líder".

Tono y estilo:
- Español neutro latinoamericano, cercano y simple, para alguien que nunca vendió este servicio. Tutea al SDR.
- Analogías de la vida diaria y ejemplos concretos, elegidos según el rubro del cliente.
- Cada concepto técnico: qué significa en simple y por qué te importa para vender.
- Frases cortas, sin jerga sin explicar.
- Cada módulo cierra con "remember" (Lo que debes recordar): una o dos frases.
- Nombra clientes del cliente solo si están en los materiales. Nunca hables mal de la competencia; posiciona al cliente como complemento.
- Texto plano: sin markdown, sin asteriscos ni almohadillas.

Responde siempre con la herramienta guardar_modulo.`;

const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;

const TOOL: Anthropic.Tool = {
  name: "guardar_modulo",
  description: "Guarda un módulo de la Academia SDR como bloques de contenido.",
  input_schema: {
    type: "object",
    properties: {
      title: str,
      subtitle: { type: "string", description: "Una frase que resume la vuelta" },
      blocks: {
        type: "array",
        description: "Bloques en el orden en que se leen. Cada bloque usa solo los campos de su tipo.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["text", "bullets", "callout", "concepts", "facts", "story", "services", "steps", "glossary", "roles", "needs", "cases", "dosdonts", "builder", "examples", "script", "sequence", "checklist", "questions", "objections", "plan", "quiz"],
            },
            heading: str,
            paragraphs: { ...strArr, description: "text" },
            items: {
              type: "array",
              description: "bullets/questions: strings. concepts/glossary: {term, simple, why}. facts: {label, value}. checklist: {text, critical}.",
              items: {},
            },
            text: { type: "string", description: "callout" },
            tone: { type: "string", enum: ["info", "alerta", "tip"] },
            problem: str, solution: str, result: str, analogy: str,
            services: { type: "array", items: { type: "object", properties: { name: str, analogy: str, meaning: str, example: str, focus: { type: "boolean" } } } },
            steps: { type: "array", description: "steps: {title, detail}. sequence: {day, channel, action}.", items: { type: "object" } },
            roles: { type: "array", items: { type: "object", properties: { role: str, kind: { type: "string", enum: ["decide", "influye", "no_decide"] }, cares: str } } },
            needs: { type: "array", items: { type: "object", properties: { segment: str, problem: str, phrases: strArr } } },
            cases: { type: "array", items: { type: "object", properties: { industry: str, client: str, story: str, oneLiner: str } } },
            dos: strArr, donts: strArr,
            pieces: { type: "object", properties: { context: strArr, help: strArr, proof: strArr, question: strArr } },
            examples: { type: "array", items: { type: "object", properties: { channel: str, title: str, text: str } } },
            lines: { type: "array", items: { type: "object", properties: { speaker: str, text: str } } },
            objections: { type: "array", items: { type: "object", properties: { objection: str, meaning: str, answer: str } } },
            days: { type: "array", items: { type: "object", properties: { day: str, title: str, tasks: strArr } } },
            questions: { type: "array", items: { type: "object", properties: { q: str, options: strArr, answer: { type: "integer" }, explain: str } } },
          },
          required: ["type"],
        },
      },
      remember: { type: "string", description: "Lo que debes recordar (1-2 frases)" },
      openQuestions: { ...strArr, description: "Datos a confirmar con el cliente antes de usar la capacitación" },
    },
    required: ["title", "blocks", "remember"],
  },
};

// ── Contexto del cliente ────────────────────────────────────────────────

export async function loadClientMaterials(db: SupabaseClient, clientId: string): Promise<{ clientName: string; text: string; docCount: number; hasIcp: boolean }> {
  const [{ data: client }, { data: docs }, { data: industries }, { data: icp }] = await Promise.all([
    db.from("clients").select("name").eq("id", clientId).maybeSingle(),
    db.from("client_ai_context").select("file_name, file_type, content").eq("client_id", clientId).order("uploaded_at", { ascending: false }),
    db.from("icp_industries").select("id, name").eq("client_id", clientId),
    db.from("icp_config").select("notes").eq("client_id", clientId).eq("is_active", true).maybeSingle(),
  ]);

  const parts: string[] = [];
  let hasIcp = false;
  for (const d of (docs ?? []) as { file_name: string; file_type: string | null; content: string | null }[]) {
    if (!d.content?.trim()) continue;
    if (d.file_type === "icp") hasIcp = true;
    parts.push(`<documento nombre="${d.file_name}" tipo="${d.file_type ?? "otro"}">\n${d.content.trim()}\n</documento>`);
  }

  const inds = (industries ?? []) as { id: string; name: string }[];
  if (inds.length) {
    const { data: sections } = await db
      .from("icp_industry_sections")
      .select("industry_id, section_key, content")
      .in("industry_id", inds.map((i) => i.id));
    for (const ind of inds) {
      const txt = ((sections ?? []) as { industry_id: string; section_key: string; content: string }[])
        .filter((s) => s.industry_id === ind.id && s.content?.trim())
        .map((s) => `[${s.section_key}]\n${s.content.trim()}`)
        .join("\n\n");
      if (txt) {
        hasIcp = true;
        parts.push(`<icp_industria industria="${ind.name}">\n${txt}\n</icp_industria>`);
      }
    }
  }
  if (icp?.notes?.trim()) parts.push(`<notas_icp>\n${icp.notes.trim()}\n</notas_icp>`);

  let text = parts.join("\n\n");
  if (text.length > MAX_CONTEXT_CHARS) text = text.slice(0, MAX_CONTEXT_CHARS) + "\n[… contexto recortado]";
  return { clientName: client?.name ?? "Cliente", text, docCount: parts.length, hasIcp };
}

// ── Generación de un módulo ─────────────────────────────────────────────

export async function generateModule(opts: {
  db: SupabaseClient;
  clientId: string;
  moduleNo: number;
  inputs: AcademyInputs;
  userEmail?: string | null;
}): Promise<AcademyModule> {
  const def = getModuleDef(opts.moduleNo);
  if (!def) throw new Error("Módulo inválido");

  const materials = await loadClientMaterials(opts.db, opts.clientId);
  if (!materials.text) throw new Error("El cliente no tiene Contexto IA ni ICP cargados: súbelos en Sistema → Contexto IA antes de generar la academia.");
  const model = await getClientModel(opts.db, opts.clientId);

  const { inputs } = opts;
  const focus = `<foco_campana>
Cliente: ${materials.clientName}
Servicio foco de la campaña: ${inputs.focusService || "(no indicado)"}
Países de esta fase: ${inputs.countries || "(no indicado)"}
Industrias prioritarias: ${inputs.industries || "(según el ICP)"}
Indicaciones del equipo BullsEye: ${inputs.notes || "(ninguna)"}
</foco_campana>`;

  const outline = MODULES.map((m) => `${m.no}. ${m.title}`).join("\n");

  const message = await anthropic().messages.create({
    model,
    max_tokens: def.maxTokens,
    system: [
      { type: "text", text: SYSTEM_RULES },
      { type: "text", text: `<contexto_cliente>\n${materials.text}\n</contexto_cliente>\n\n${focus}\n\nEstructura completa de la academia:\n${outline}`, cache_control: { type: "ephemeral" } },
    ],
    tools: [TOOL],
    tool_choice: { type: "tool", name: "guardar_modulo" },
    messages: [{ role: "user", content: `Escribe la vuelta ${def.no}: "${def.title}".\n\n${def.instructions}` }],
  });

  void logAiUsage({
    clientId: opts.clientId,
    functionName: "academia_sdr_module",
    model,
    // Lecturas de caché cuestan ~10% del input normal: se registran así para no inflar el costo
    inputTokens: message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + Math.round((message.usage.cache_read_input_tokens ?? 0) * 0.1),
    outputTokens: message.usage.output_tokens,
    metadata: { module_no: def.no, user: opts.userEmail ?? null, stop_reason: message.stop_reason },
  });

  const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("La IA no devolvió el módulo");
  if (message.stop_reason === "max_tokens") throw new Error("La respuesta de la IA quedó cortada; vuelve a generar este módulo.");

  const mod = sanitizeModule(toolUse.input, def.no, def.title);
  await opts.db
    .from("sdr_academy_modules")
    .upsert({ client_id: opts.clientId, module_no: def.no, content: mod, model, generated_at: new Date().toISOString() }, { onConflict: "client_id,module_no" });
  return mod;
}

// ── Lectura ─────────────────────────────────────────────────────────────

export async function loadAcademy(db: SupabaseClient, clientId: string): Promise<AcademyRecord> {
  const [{ data: client }, { data: academy }, { data: rows }] = await Promise.all([
    db.from("clients").select("name").eq("id", clientId).maybeSingle(),
    db.from("sdr_academies").select("inputs, generated_at, generated_by").eq("client_id", clientId).maybeSingle(),
    db.from("sdr_academy_modules").select("module_no, content").eq("client_id", clientId),
  ]);
  const modules: (AcademyModule | null)[] = MODULES.map(() => null);
  for (const r of (rows ?? []) as { module_no: number; content: unknown }[]) {
    const def = getModuleDef(r.module_no);
    if (def) modules[def.no - 1] = sanitizeModule(r.content, def.no, def.title);
  }
  return {
    clientName: client?.name ?? "Cliente",
    inputs: academy ? sanitizeInputs(academy.inputs) : { ...EMPTY_INPUTS },
    modules,
    generatedAt: academy?.generated_at ?? null,
    generatedBy: academy?.generated_by ?? null,
  };
}

// ── Saneamiento de lo que devuelve la IA ────────────────────────────────

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const sa = (v: unknown): string[] => (Array.isArray(v) ? v.map(s).filter(Boolean) : []);
const oa = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Record<string, unknown>[] : []);

function sanitizeBlock(raw: Record<string, unknown>): Block | null {
  const heading = s(raw.heading) || undefined;
  switch (raw.type) {
    case "text": return { type: "text", heading, paragraphs: sa(raw.paragraphs).length ? sa(raw.paragraphs) : sa([raw.text]) };
    case "bullets": return { type: "bullets", heading, items: sa(raw.items) };
    case "questions": return { type: "questions", heading, items: sa(raw.items) };
    case "callout": return { type: "callout", heading, text: s(raw.text), tone: raw.tone === "alerta" || raw.tone === "tip" ? raw.tone : "info" };
    case "concepts":
    case "glossary":
      return { type: raw.type, heading, items: oa(raw.items).map((i) => ({ term: s(i.term), simple: s(i.simple), why: s(i.why) })).filter((i) => i.term) };
    case "facts": return { type: "facts", heading, items: oa(raw.items).map((i) => ({ label: s(i.label), value: s(i.value) })).filter((i) => i.label) };
    case "story": return { type: "story", heading, problem: s(raw.problem), solution: s(raw.solution), result: s(raw.result), analogy: s(raw.analogy) || undefined };
    case "services": return { type: "services", heading, services: oa(raw.services).map((i) => ({ name: s(i.name), analogy: s(i.analogy), meaning: s(i.meaning), example: s(i.example), focus: i.focus === true })).filter((i) => i.name) };
    case "steps": return { type: "steps", heading, steps: oa(raw.steps).map((i) => ({ title: s(i.title), detail: s(i.detail) })).filter((i) => i.title) };
    case "roles": return { type: "roles", heading, roles: oa(raw.roles).map((i) => ({ role: s(i.role), kind: (i.kind === "decide" || i.kind === "influye" ? i.kind : "no_decide") as "decide" | "influye" | "no_decide", cares: s(i.cares) })).filter((i) => i.role) };
    case "needs": return { type: "needs", heading, needs: oa(raw.needs).map((i) => ({ segment: s(i.segment), problem: s(i.problem), phrases: sa(i.phrases) })).filter((i) => i.segment || i.problem) };
    case "cases": return { type: "cases", heading, cases: oa(raw.cases).map((i) => ({ industry: s(i.industry), client: s(i.client), story: s(i.story), oneLiner: s(i.oneLiner) })).filter((i) => i.client) };
    case "dosdonts": return { type: "dosdonts", heading, dos: sa(raw.dos), donts: sa(raw.donts) };
    case "builder": {
      const p = (raw.pieces && typeof raw.pieces === "object" ? raw.pieces : {}) as Record<string, unknown>;
      return { type: "builder", heading, pieces: { context: sa(p.context), help: sa(p.help), proof: sa(p.proof), question: sa(p.question) } };
    }
    case "examples": return { type: "examples", heading, examples: oa(raw.examples).map((i) => ({ channel: s(i.channel), title: s(i.title), text: s(i.text) })).filter((i) => i.text) };
    case "script": return { type: "script", heading, lines: oa(raw.lines).map((i) => ({ speaker: s(i.speaker), text: s(i.text) })).filter((i) => i.text) };
    case "sequence": return { type: "sequence", heading, steps: oa(raw.steps).map((i) => ({ day: s(i.day), channel: s(i.channel), action: s(i.action) })).filter((i) => i.action) };
    case "checklist": return { type: "checklist", heading, items: oa(raw.items).map((i) => ({ text: s(i.text), critical: i.critical === true })).filter((i) => i.text) };
    case "objections": return { type: "objections", heading, objections: oa(raw.objections).map((i) => ({ objection: s(i.objection), meaning: s(i.meaning), answer: s(i.answer) })).filter((i) => i.objection) };
    case "plan": return { type: "plan", heading, days: oa(raw.days).map((i) => ({ day: s(i.day), title: s(i.title), tasks: sa(i.tasks) })).filter((i) => i.day || i.title) };
    case "quiz":
      return {
        type: "quiz", heading,
        questions: oa(raw.questions)
          .map((i) => ({ q: s(i.q), options: sa(i.options), answer: typeof i.answer === "number" ? Math.trunc(i.answer) : Number(i.answer), explain: s(i.explain) || undefined }))
          .filter((i) => i.q && i.options.length >= 2 && i.answer >= 0 && i.answer < i.options.length),
      };
    default: return null;
  }
}

export function sanitizeModule(raw: unknown, no: number, fallbackTitle: string): AcademyModule {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const blocks = oa(o.blocks).map(sanitizeBlock).filter((b): b is Block => b !== null);
  return {
    no,
    title: s(o.title) || fallbackTitle,
    subtitle: s(o.subtitle) || undefined,
    blocks,
    remember: s(o.remember),
    openQuestions: sa(o.openQuestions),
  };
}
