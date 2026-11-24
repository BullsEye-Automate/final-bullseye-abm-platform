import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import { logAiUsage } from "@/lib/aiUsageLogger";
import { supabaseAdmin } from "@/lib/supabase";
import { loadIcpContent } from "@/lib/icpStore";
import { compactName } from "@/lib/academiaSdr/catalog";

// Resumen enriquecido del mensaje de WhatsApp que el SDR manda al cliente
// cuando registra una reunión (Formulario de reuniones). La IA busca en la web
// la empresa del prospecto y arma el contexto de la cuenta, quién es el
// contacto, el resumen de la llamada y recomendaciones para la reunión. El correo y el
// teléfono del prospecto NO se mandan a la IA: los pone el formulario.
// Ver CLAUDE.md → "Formulario de reuniones".

export type SummaryInput = {
  cliente: string;
  empresa: string;
  pais: string;
  contacto: string;
  cargo: string;
  origen: string;
  industria: string;
  comentario: string;
  fecha_reunion: string;
};

export type SummaryAi = {
  empresa: string; // nombre comercial ("Principal Chile")
  contacto: string; // nombre ordenado
  cargo: string; // sin repeticiones ni "en <empresa>"
  contexto_cuenta: string[]; // 2-4 viñetas con contexto verificado de la empresa
  sobre_contacto: string[]; // 1-2 viñetas sobre el rol del contacto
  resumen: string; // comentario del SDR pulido
  recomendaciones: string[]; // 3-5 viñetas para preparar la reunión
};

const MAX_WEB_SEARCHES = 6;
const WEB_SEARCH_USD = 0.01;
const MAX_ROUNDS = 4; // pause_turn de la búsqueda web

const SUMMARY_TOOL = {
  name: "entregar_resumen",
  description:
    "Entrega el resumen final de la reunión para el mensaje de WhatsApp al cliente. Llamar una sola vez, al final, cuando ya terminaste de investigar.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["empresa", "contacto", "cargo", "contexto_cuenta", "sobre_contacto", "resumen", "recomendaciones"],
    properties: {
      empresa: {
        type: "string",
        description:
          "Nombre comercial de la empresa del prospecto, bien escrito (ej. 'Principal Chile'). Sin razón social ni descripción.",
      },
      contacto: {
        type: "string",
        description: "Nombre del contacto bien escrito (mayúsculas y tildes), sin agregar ni inventar nombres.",
      },
      cargo: {
        type: "string",
        description:
          "Cargo del contacto limpio: sin repeticiones y sin ' en <empresa>' al final (ej. 'Data Analytics & AI Assistant Director').",
      },
      contexto_cuenta: {
        type: "array",
        items: { type: "string" },
        description:
          "2 a 4 viñetas (cada una de 1 a 3 frases, máx. 420 caracteres) con contexto verificado en la web que le sirva al cliente para entender la cuenta: qué es la empresa y a qué grupo pertenece, tamaño y negocios; momento del negocio o de su industria (regulación, reformas, cambios, noticias de los últimos 12-18 meses) y por qué eso conecta con lo que vende el cliente; particularidades que afectan la venta (grupo global con estándares corporativos, industria regulada, relación previa con el cliente si aparece en su portafolio). Solo hechos encontrados; lista vacía si no encontraste nada confiable.",
      },
      sobre_contacto: {
        type: "array",
        items: { type: "string" },
        description:
          "1 o 2 viñetas sobre el contacto deducidas de su cargo y del comentario (no busques a la persona en la web): qué hace probablemente en su rol, si es un perfil técnico o de negocio y qué peso tiene en la decisión. Usa su primer nombre. Sin datos personales.",
      },
      resumen: {
        type: "string",
        description:
          "El comentario del SDR pulido en 1 a 3 frases: qué le interesa al prospecto y qué tipo de reunión es. Corrige ortografía y redacción, nombra al cliente por su nombre, sin inventar nada que no diga el comentario, sin fecha ni hora y sin información personal o sensible del prospecto (salud, licencias, vacaciones, familia).",
      },
      recomendaciones: {
        type: "array",
        items: { type: "string" },
        description:
          "3 a 5 viñetas accionables para que el cliente prepare la reunión, específicas para esta cuenta y este contacto según lo que vende el cliente: en qué enfocar su oferta; qué casos de éxito llevar (industria o tipo de cliente parecido); una viñeta que empiece con 'Preguntas sugeridas:' con 3-4 preguntas concretas; a quién sumar a la reunión según el perfil del contacto; y, solo si en las reuniones recientes del cliente hay una empresa claramente relacionada (misma industria o tema), sugerir cruzar aprendizajes nombrándola. Nada genérico ni inventado sobre el cliente.",
      },
    },
  },
} as const;

// Cliente de la app por el nombre que trae el formulario (Maestra).
async function findClient(name: string): Promise<{ id: string; name: string } | null> {
  const key = compactName(name);
  if (!key) return null;
  const { data } = await supabaseAdmin().from("clients").select("id, name, slug").eq("is_active", true);
  const rows = (data ?? []) as { id: string; name: string; slug: string | null }[];
  const scored = rows
    .map((r) => {
      const names = [compactName(r.name), compactName(r.slug ?? "")].filter(Boolean);
      const exact = names.includes(key);
      const prefix = names.some((n) => n.startsWith(key) || key.startsWith(n));
      return { r, score: exact ? 2 : prefix ? 1 : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return null;
  return { id: scored[0].r.id, name: scored[0].r.name };
}

// Reuniones recientes del mismo cliente (planilla de reuniones, últimos 180
// días): empresa, industria y cargo, para que la IA pueda sugerir cruzar
// aprendizajes con cuentas parecidas. Sin datos de contacto del prospecto.
async function recentMeetings(clientId: string, empresa: string): Promise<string> {
  const since = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const { data } = await supabaseAdmin()
    .from("meetings")
    .select("empresa, industria, contacto_cargo, fecha_reunion")
    .eq("client_id", clientId)
    .gte("fecha_reunion", since)
    .order("fecha_reunion", { ascending: false })
    .limit(150);
  const own = compactName(empresa);
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of (data ?? []) as { empresa: string | null; industria: string | null; contacto_cargo: string | null }[]) {
    const key = compactName(r.empresa ?? "");
    if (!key || key === own || seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${r.empresa}${r.industria ? ` (${r.industria})` : ""}${r.contacto_cargo ? ` · ${r.contacto_cargo}` : ""}`);
    if (lines.length >= 40) break;
  }
  return lines.join("\n");
}

async function clientContext(
  clientName: string,
  empresa: string
): Promise<{ id: string | null; text: string; meetings: string }> {
  try {
    const client = await findClient(clientName);
    if (!client) return { id: null, text: "", meetings: "" };
    const [icp, meetings] = await Promise.all([
      loadIcpContent(supabaseAdmin(), client.id, null).catch(() => ""),
      recentMeetings(client.id, empresa).catch(() => ""),
    ]);
    return { id: client.id, text: icp.trim().slice(0, 6000), meetings };
  } catch {
    return { id: null, text: "", meetings: "" };
  }
}

function buildPrompt(input: SummaryInput, icp: string, meetings: string): string {
  const lines = [
    `Cliente de BullsEye (quien vende): ${input.cliente}`,
    `Empresa del prospecto: ${input.empresa}`,
    `País: ${input.pais}`,
    `Industria (según el SDR): ${input.industria || "—"}`,
    `Contacto: ${input.contacto}`,
    `Cargo: ${input.cargo}`,
    `Canal por el que se agendó: ${input.origen || "—"}`,
    `Fecha de la reunión: ${input.fecha_reunion || "—"}`,
    "",
    "Comentario del SDR sobre la llamada:",
    input.comentario?.trim() || "(sin comentario)",
  ];
  if (icp) {
    lines.push("", `Contexto del cliente ${input.cliente} (ICP y propuesta de valor, extracto):`, icp);
  }
  if (meetings) {
    lines.push("", `Otras reuniones recientes de ${input.cliente} (empresa · industria · cargo):`, meetings);
  }
  return lines.join("\n");
}

const SYSTEM = `Eres analista de BullsEye, agencia de prospección B2B. Un SDR acaba de agendar una reunión para un cliente de BullsEye y hay que avisarle al cliente por WhatsApp con un mensaje que le dé contexto real para preparar la reunión: quién es la cuenta, qué momento vive, quién es el contacto y cómo abordar la conversación desde lo que vende el cliente.

Investiga en la web SOLO la empresa del prospecto (no busques a la persona): grupo al que pertenece, tamaño y negocios, noticias y cambios recientes, y el momento de su industria en su país (regulación, reformas). Si sirve, revisa también la relación entre esa empresa y el cliente (por ejemplo si aparece en su portafolio o casos de éxito). Haz búsquedas precisas.

Reglas:
- Todo en español neutro, frases cortas, sin emojis ni markdown.
- No inventes: lo que no verificaste no va. El contexto de la cuenta lleva solo hechos encontrados; las recomendaciones se basan en lo que vende el cliente (su contexto) y en lo que encontraste.
- Las recomendaciones son concretas para esta cuenta y este contacto, no consejos genéricos de ventas.
- El mensaje lo lee el cliente: nada de información personal o sensible del prospecto (salud, licencias médicas, vacaciones, temas familiares) ni comentarios internos del SDR.
- Termina llamando a la herramienta entregar_resumen.`;

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export async function generateMeetingSummary(input: SummaryInput, userId: string | null): Promise<SummaryAi> {
  const ctx = await clientContext(input.cliente, input.empresa);
  const client = anthropic();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildPrompt(input, ctx.text, ctx.meetings) }];
  // La versión _20260209 de la búsqueda web (filtrado dinámico) aún no está
  // tipada en el SDK instalado: se pasa tal cual.
  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: MAX_WEB_SEARCHES },
    SUMMARY_TOOL,
  ] as unknown as Anthropic.ToolUnion[];

  let inTok = 0;
  let outTok = 0;
  let searches = 0;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 12000,
        system: SYSTEM,
        tools,
        tool_choice: { type: "auto" },
        thinking: { type: "adaptive" } as unknown as Anthropic.ThinkingConfigParam,
        messages,
      });
      inTok += res.usage.input_tokens;
      outTok += res.usage.output_tokens;
      searches += res.usage.server_tool_use?.web_search_requests ?? 0;

      if (res.stop_reason === "refusal") throw new Error("La IA no pudo generar el resumen");
      const call = res.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === SUMMARY_TOOL.name
      );
      if (call) return normalize(call.input as SummaryAi);
      if (res.stop_reason === "pause_turn") {
        // La búsqueda web pausó el turno: se devuelve tal cual para que siga.
        messages.push({ role: "assistant", content: res.content });
        continue;
      }
      // Terminó sin llamar a la herramienta: se le pide una vez más.
      messages.push({ role: "assistant", content: res.content.length ? res.content : textOf(res.content) || "…" });
      messages.push({ role: "user", content: "Entrega ahora el resumen llamando a entregar_resumen." });
    }
    throw new Error("La IA no entregó el resumen");
  } finally {
    void logAiUsage({
      clientId: ctx.id,
      userId,
      functionName: "formulario_reunion_resumen",
      model: CLAUDE_MODEL,
      inputTokens: inTok,
      outputTokens: outTok,
      metadata: { web_searches: searches, empresa: input.empresa },
      // Búsqueda web: US$10 por 1.000 búsquedas (se cobra aparte de los tokens).
      extraCostUsd: searches * WEB_SEARCH_USD,
    });
  }
}

function clean(s: unknown, max: number): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function bullets(list: unknown, max: number, len: number): string[] {
  return (Array.isArray(list) ? list : [])
    .map((b) => clean(b, len).replace(/^[•\-–]\s*/, ""))
    .filter(Boolean)
    .slice(0, max);
}

function normalize(x: SummaryAi): SummaryAi {
  return {
    empresa: clean(x.empresa, 160),
    contacto: clean(x.contacto, 120),
    cargo: clean(x.cargo, 160),
    contexto_cuenta: bullets(x.contexto_cuenta, 4, 600),
    sobre_contacto: bullets(x.sobre_contacto, 2, 400),
    resumen: String(x.resumen ?? "").trim().slice(0, 800),
    recomendaciones: bullets(x.recomendaciones, 5, 600),
  };
}
