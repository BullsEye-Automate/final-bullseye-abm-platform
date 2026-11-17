import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import { logAiUsage } from "@/lib/aiUsageLogger";
import { supabaseAdmin } from "@/lib/supabase";
import { loadIcpContent } from "@/lib/icpStore";
import { compactName } from "@/lib/academiaSdr/catalog";

// Resumen enriquecido del mensaje de WhatsApp que el SDR manda al cliente
// cuando registra una reunión (Formulario de reuniones). La IA busca en la web
// la empresa del prospecto y arma rubro, rol del contacto, contexto de la
// llamada reescrito, nivel de interés y contexto de la cuenta. El correo y el
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
  empresa: string; // "Caja Los Andes (CCAF Los Andes)"
  giro: string; // una línea: a qué se dedica
  contacto: string; // nombre ordenado
  cargo: string; // sin repeticiones
  rol: string; // rol en la decisión
  contexto_llamada: string;
  interes: string; // "Medio-alto (abierto a conversar su agenda 2027)"
  contexto_cuenta: string[]; // 3-5 viñetas verificadas
};

const MAX_WEB_SEARCHES = 5;
const MAX_ROUNDS = 4; // pause_turn de la búsqueda web

const SUMMARY_TOOL = {
  name: "entregar_resumen",
  description:
    "Entrega el resumen final de la reunión para el mensaje de WhatsApp al cliente. Llamar una sola vez, al final, cuando ya terminaste de investigar.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["empresa", "giro", "contacto", "cargo", "rol", "contexto_llamada", "interes", "contexto_cuenta"],
    properties: {
      empresa: {
        type: "string",
        description:
          "Nombre comercial de la empresa del prospecto y, entre paréntesis, su razón social o sigla conocida solo si aporta (ej. 'Caja Los Andes (CCAF Los Andes)'). Si no la verificaste, el nombre tal como lo escribió el SDR, bien capitalizado.",
      },
      giro: {
        type: "string",
        description:
          "Una línea (máx. 140 caracteres) con a qué se dedica la empresa: rubro y principales productos o servicios. Vacío si no lo pudiste verificar.",
      },
      contacto: {
        type: "string",
        description: "Nombre del contacto bien escrito (mayúsculas y tildes), sin agregar ni inventar nombres.",
      },
      cargo: {
        type: "string",
        description: "Cargo del contacto sin repeticiones ni ruido (si el SDR lo escribió dos veces, una sola).",
      },
      rol: {
        type: "string",
        description:
          "Rol probable del contacto en la decisión de compra según su cargo y lo que vende el cliente (ej. 'Dueño del área de BI y analítica (influenciador clave / posible decisor en su ámbito)'). Una línea.",
      },
      contexto_llamada: {
        type: "string",
        description:
          "Contexto de la llamada reescrito a partir del comentario del SDR, en 2-4 frases, en pasado y tercera persona impersonal ('Se le presentó…', 'Conversamos sobre…'). Nombra al cliente por su nombre. Sin información personal o sensible del prospecto (salud, licencias, vacaciones, familia), sin fecha ni hora de la reunión (ya van en otra línea) y sin inventar nada que no diga el comentario.",
      },
      interes: {
        type: "string",
        description:
          "Nivel de interés según el comentario: Alto, Medio-alto, Medio o Bajo, y entre paréntesis el motivo en pocas palabras.",
      },
      contexto_cuenta: {
        type: "array",
        items: { type: "string" },
        description:
          "3 a 5 viñetas cortas (máx. 170 caracteres cada una) con hechos verificados en la web sobre la empresa que sirvan al cliente para preparar la reunión: si es o fue cliente del cliente / aparece en su portafolio, tamaño o posición en el mercado, noticias o cambios recientes (últimos 12-18 meses), iniciativas relacionadas con lo que vende el cliente, regulación. Solo hechos que encontraste; si no encontraste nada confiable, lista vacía. Sin el viñeta '•'.",
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

async function clientContext(clientName: string): Promise<{ id: string | null; text: string }> {
  try {
    const client = await findClient(clientName);
    if (!client) return { id: null, text: "" };
    const icp = (await loadIcpContent(supabaseAdmin(), client.id, null)).trim();
    return { id: client.id, text: icp.slice(0, 6000) };
  } catch {
    return { id: null, text: "" };
  }
}

function buildPrompt(input: SummaryInput, icp: string): string {
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
  return lines.join("\n");
}

const SYSTEM = `Eres analista de BullsEye, agencia de prospección B2B. Un SDR acaba de agendar una reunión para un cliente de BullsEye y hay que avisarle al cliente por WhatsApp con un mensaje breve y útil para preparar la reunión.

Investiga en la web SOLO la empresa del prospecto (no busques a la persona) y, si sirve, la relación entre esa empresa y el cliente (por ejemplo si aparece en su portafolio o casos de éxito en el sitio del cliente). Haz pocas búsquedas y precisas.

Reglas:
- Todo en español neutro, frases cortas, sin emojis ni markdown.
- No inventes: lo que no verificaste no va. El contexto de la cuenta lleva solo hechos encontrados.
- El mensaje lo lee el cliente: nada de información personal o sensible del prospecto (salud, licencias médicas, vacaciones, temas familiares) ni comentarios internos del SDR.
- Termina llamando a la herramienta entregar_resumen.`;

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export async function generateMeetingSummary(input: SummaryInput, userId: string | null): Promise<SummaryAi> {
  const ctx = await clientContext(input.cliente);
  const client = anthropic();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildPrompt(input, ctx.text) }];
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
        max_tokens: 8000,
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
    });
  }
}

function clean(s: unknown, max: number): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalize(x: SummaryAi): SummaryAi {
  return {
    empresa: clean(x.empresa, 160),
    giro: clean(x.giro, 220),
    contacto: clean(x.contacto, 120),
    cargo: clean(x.cargo, 160),
    rol: clean(x.rol, 220),
    contexto_llamada: String(x.contexto_llamada ?? "").trim().slice(0, 1500),
    interes: clean(x.interes, 160),
    contexto_cuenta: (Array.isArray(x.contexto_cuenta) ? x.contexto_cuenta : [])
      .map((b) => clean(b, 260).replace(/^[•\-–]\s*/, ""))
      .filter(Boolean)
      .slice(0, 5),
  };
}
