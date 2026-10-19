import crypto from "crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, getClientModel } from "./claude";
import { logAiUsage } from "./aiUsageLogger";
import type { FilterCatalog } from "./unifiedSearch";
import type { UnifiedFilterKey, UnifiedFilters } from "./unifiedFilterDefs";

// IA de la wishlist del portal:
//  1. scoreCompanies: % de fit (0–100) + razón de cada empresa contra el ICP
//     del cliente. Se cachea en company_fit_scores por (cliente, fuente,
//     empresa, hash del ICP) — si el ICP cambia, se recalcula.
//  2. icpToUnifiedFilters: traduce el ICP (texto libre) a los filtros
//     unificados del portal, para el modo "Recomendadas por IA".

export type FitCandidate = { key: string; name: string; summary: string };
export type FitResult = { fit_score: number; fit_reason: string };

export function icpHash(icpText: string): string {
  return crypto.createHash("sha256").update(icpText.trim()).digest("hex").slice(0, 16);
}

// Lotes chicos en paralelo: cada uno responde más rápido (el ICP va cacheado),
// así una tanda de la recomendación IA cabe holgada en el límite de 60 s
const SCORE_BATCH = 8;

const SCORE_SYSTEM = `Eres analista senior de prospección B2B en BullsEye, una agencia de prospección en Latinoamérica.
Recibes el ICP (perfil de cliente ideal) de un cliente de BullsEye y una lista de empresas candidatas.
Para cada empresa estima qué tan buen fit es con ese ICP:
- fit_score de 0 a 100 (80+ fit claro, 60–79 fit probable, 40–59 dudoso, <40 no fit).
- Considera industria, tamaño, geografía, modelo de negocio, tecnologías, señales positivas y descalificadores del ICP.
- Si falta información, no inventes: baja la certeza y dilo en la razón.
- fit_reason: 1–2 oraciones en español, concretas, citando los datos de la empresa que justifican el puntaje (ej. "SaaS B2B de 120 empleados en Chile, usa HubSpot; calza con industria y tamaño objetivo").
Devuelve un resultado por cada empresa usando su key exacta.`;

const SCORE_TOOL: Anthropic.Tool = {
  name: "report_fit",
  description: "Reporta el puntaje de fit de cada empresa",
  input_schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            fit_score: { type: "integer", minimum: 0, maximum: 100 },
            fit_reason: { type: "string" },
          },
          required: ["key", "fit_score", "fit_reason"],
        },
      },
    },
    required: ["results"],
  },
};

export async function scoreCompanies(
  db: SupabaseClient,
  opts: { clientId: string; icpText: string; source: string; candidates: FitCandidate[] }
): Promise<Map<string, FitResult>> {
  const hash = icpHash(opts.icpText);
  const out = new Map<string, FitResult>();
  if (!opts.candidates.length) return out;

  const { data: cached } = await db
    .from("company_fit_scores")
    .select("source_key, fit_score, fit_reason")
    .eq("client_id", opts.clientId)
    .eq("source", opts.source)
    .eq("icp_hash", hash)
    .in("source_key", opts.candidates.map((c) => c.key));
  for (const c of cached ?? []) out.set(c.source_key, { fit_score: c.fit_score, fit_reason: c.fit_reason });

  const pending = opts.candidates.filter((c) => !out.has(c.key));
  if (!pending.length) return out;

  const model = await getClientModel(db, opts.clientId);
  const batches: FitCandidate[][] = [];
  for (let i = 0; i < pending.length; i += SCORE_BATCH) batches.push(pending.slice(i, i + SCORE_BATCH));

  await Promise.all(
    batches.map(async (batch) => {
      const companiesText = batch
        .map((c) => `<empresa key="${c.key}">\nNombre: ${c.name}\n${c.summary}\n</empresa>`)
        .join("\n\n");
      const message = await anthropic().messages.create({
        model,
        max_tokens: 3000,
        temperature: 0,
        system: [{ type: "text", text: SCORE_SYSTEM }],
        tools: [SCORE_TOOL],
        tool_choice: { type: "tool", name: SCORE_TOOL.name },
        messages: [
          {
            role: "user",
            content: [
              // El ICP se repite en cada lote: se cachea para no pagarlo completo cada vez
              { type: "text", text: `<icp>\n${opts.icpText}\n</icp>`, cache_control: { type: "ephemeral" } },
              { type: "text", text: `<empresas>\n${companiesText}\n</empresas>` },
            ],
          },
        ],
      });
      void logAiUsage({
        clientId: opts.clientId,
        functionName: "portal_wishlist_fit",
        model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        metadata: { source: opts.source, companies: batch.length },
      });

      const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const results = ((block?.input as { results?: { key: string; fit_score: number; fit_reason: string }[] })?.results ?? [])
        .filter((r) => batch.some((c) => c.key === r.key));
      const rows = results.map((r) => ({
        client_id: opts.clientId,
        source: opts.source,
        source_key: r.key,
        icp_hash: hash,
        fit_score: Math.max(0, Math.min(100, Math.round(Number(r.fit_score) || 0))),
        fit_reason: String(r.fit_reason ?? "").slice(0, 600),
      }));
      for (const r of rows) out.set(r.source_key, { fit_score: r.fit_score, fit_reason: r.fit_reason });
      if (rows.length) await db.from("company_fit_scores").upsert(rows, { onConflict: "client_id,source,source_key,icp_hash" });
    })
  );

  return out;
}

// ── ICP → filtros unificados (modo "Recomendadas por IA") ───────────────

const ICP_FILTERS_TOOL: Anthropic.Tool = {
  name: "set_filters",
  description: "Define los filtros de búsqueda de empresas",
  input_schema: {
    type: "object",
    properties: {
      description: { type: "string", description: "Una frase EN INGLÉS que describa la empresa ideal (búsqueda semántica)" },
      keyword: { type: "string" },
      industries: { type: "array", items: { type: "string" } },
      countries: { type: "array", items: { type: "string" } },
      sizes: { type: "array", items: { type: "string" } },
      revenues: { type: "array", items: { type: "string" } },
      markets: { type: "array", items: { type: "string" } },
      technologies: { type: "array", items: { type: "string" } },
    },
  },
};

const MAX_OPTIONS_IN_PROMPT = 250;

export async function icpToUnifiedFilters(
  db: SupabaseClient,
  clientId: string,
  icpText: string,
  catalog: FilterCatalog
): Promise<UnifiedFilters> {
  const opt = (k: UnifiedFilterKey) => catalog.options[k] ?? [];
  const has = (k: UnifiedFilterKey) => catalog.available.includes(k);
  const list = (k: UnifiedFilterKey) => opt(k).slice(0, MAX_OPTIONS_IN_PROMPT).map((o) => o.value).join(" | ");
  const lines = [
    has("description") ? "- description: una frase en inglés que describa la empresa ideal (búsqueda semántica). Úsala siempre." : null,
    has("industries") ? `- industries (valores exactos): ${list("industries")}` : null,
    has("countries") ? `- countries (valores exactos): ${list("countries")}` : null,
    has("sizes") ? `- sizes (tramos de empleados, valores exactos): ${list("sizes")}` : null,
    has("revenues") ? `- revenues (facturación USD, valores exactos): ${list("revenues")}` : null,
    has("markets") ? `- markets (valores exactos): ${list("markets")}` : null,
    has("technologies") ? "- technologies: nombres de tecnologías/software que use la empresa ideal (solo si el ICP las menciona)" : null,
    "- keyword: una palabra clave (solo si es muy específica del ICP)",
  ].filter(Boolean).join("\n");

  const model = await getClientModel(db, clientId);
  const message = await anthropic().messages.create({
    model,
    max_tokens: 1500,
    temperature: 0,
    system: [{ type: "text", text: `Eres analista de prospección B2B. Traduces el ICP de un cliente a filtros de búsqueda de empresas.
Reglas:
- Usa SOLO valores de las listas entregadas (cópialos exactos).
- Prefiere pocos filtros amplios y certeros (industria, país, tamaño) para no quedarte sin resultados.
- No uses filtros para cosas que el ICP no menciona.` }],
    tools: [ICP_FILTERS_TOOL],
    tool_choice: { type: "tool", name: ICP_FILTERS_TOOL.name },
    messages: [{ role: "user", content: `<icp>\n${icpText}\n</icp>\n\n<filtros_disponibles>\n${lines}\n</filtros_disponibles>` }],
  });
  void logAiUsage({ clientId, functionName: "portal_wishlist_icp_filters", model, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens });

  const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const raw = (block?.input ?? {}) as Record<string, unknown>;

  // Validación: solo filtros disponibles y valores existentes
  const out: UnifiedFilters = {};
  const pickValues = (k: UnifiedFilterKey) => {
    if (!has(k) || !Array.isArray(raw[k])) return;
    const allowed = new Map(opt(k).map((o) => [o.value.toLowerCase(), o.value]));
    const vals = (raw[k] as unknown[]).map((v) => allowed.get(String(v).toLowerCase())).filter((v): v is string => !!v);
    if (vals.length) out[k] = Array.from(new Set(vals));
  };
  (["industries", "countries", "sizes", "revenues", "markets"] as UnifiedFilterKey[]).forEach(pickValues);
  if (has("technologies") && Array.isArray(raw.technologies)) {
    const t = (raw.technologies as unknown[]).map(String).map((x) => x.trim()).filter(Boolean).slice(0, 10);
    if (t.length) out.technologies = t;
  }
  if (has("description") && typeof raw.description === "string" && raw.description.trim()) out.description = raw.description.trim().slice(0, 300);
  if (typeof raw.keyword === "string" && raw.keyword.trim()) out.keyword = raw.keyword.trim().slice(0, 60);
  return out;
}
