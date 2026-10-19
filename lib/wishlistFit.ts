import crypto from "crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, getClientModel } from "./claude";
import { logAiUsage } from "./aiUsageLogger";
import { isFilterableProperty, type PoolFilter, type PoolProperty } from "./hubspotPool";
import type { LemlistFilter, LemlistFilterDef } from "./lemlistDatabase";

// IA de la wishlist del portal:
//  1. scoreCompanies: % de fit (0–100) + razón de cada empresa contra el ICP
//     del cliente. Se cachea en company_fit_scores por (cliente, fuente,
//     empresa, hash del ICP) — si el ICP cambia, se recalcula.
//  2. icpToPoolFilters / icpToLemlistFilters: traduce el ICP (texto libre) a
//     filtros estructurados de cada fuente, para el modo "Recomendado por IA".

export type FitCandidate = { key: string; name: string; summary: string };
export type FitResult = { fit_score: number; fit_reason: string };

export function icpHash(icpText: string): string {
  return crypto.createHash("sha256").update(icpText.trim()).digest("hex").slice(0, 16);
}

const SCORE_BATCH = 15;

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

// ── ICP → filtros ─────────────────────────────────────────────────────────

const FILTERS_SYSTEM = `Eres analista de prospección B2B. Traduces el ICP de un cliente a filtros de búsqueda de empresas.
Reglas:
- Usa SOLO las propiedades/filtros y valores que se te entregan (copia los valores exactos).
- Prefiere pocos filtros amplios y certeros (industria, geografía, tamaño) para no quedarte sin resultados.
- No uses filtros para cosas que el ICP no menciona.`;

const POOL_FILTER_TOOL: Anthropic.Tool = {
  name: "set_filters",
  description: "Define los filtros de búsqueda",
  input_schema: {
    type: "object",
    properties: {
      filters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            property: { type: "string" },
            op: { type: "string", enum: ["in", "range"] },
            values: { type: "array", items: { type: "string" } },
            min: { type: "number" },
            max: { type: "number" },
          },
          required: ["property", "op"],
        },
      },
    },
    required: ["filters"],
  },
};

const MAX_OPTIONS_IN_PROMPT = 250;

async function runFilterTool(
  db: SupabaseClient,
  clientId: string,
  tool: Anthropic.Tool,
  functionName: string,
  icpText: string,
  catalog: string
): Promise<Record<string, unknown>[]> {
  const model = await getClientModel(db, clientId);
  const message = await anthropic().messages.create({
    model,
    max_tokens: 1500,
    temperature: 0,
    system: [{ type: "text", text: FILTERS_SYSTEM }],
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: `<icp>\n${icpText}\n</icp>\n\n<filtros_disponibles>\n${catalog}\n</filtros_disponibles>` }],
  });
  void logAiUsage({
    clientId,
    functionName,
    model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  });
  const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  return ((block?.input as { filters?: Record<string, unknown>[] })?.filters ?? []) as Record<string, unknown>[];
}

export async function icpToPoolFilters(
  db: SupabaseClient,
  clientId: string,
  icpText: string,
  properties: PoolProperty[]
): Promise<PoolFilter[]> {
  const usable = properties.filter((p) => isFilterableProperty(p.name) && (p.type === "number" || p.options.length > 0));
  const catalog = usable
    .map((p) =>
      p.type === "number"
        ? `- ${p.name} (${p.label}) — numérico, usar op "range"`
        : `- ${p.name} (${p.label}) — op "in", valores: ${p.options.slice(0, MAX_OPTIONS_IN_PROMPT).map((o) => o.value).join(" | ")}`
    )
    .join("\n");
  const raw = await runFilterTool(db, clientId, POOL_FILTER_TOOL, "portal_wishlist_icp_filters_hubspot", icpText, catalog);

  // Validación: solo propiedades y valores que existen
  const byName = new Map(usable.map((p) => [p.name, p]));
  const filters: PoolFilter[] = [];
  for (const f of raw) {
    const prop = byName.get(String(f.property));
    if (!prop) continue;
    if (f.op === "range" && prop.type === "number") {
      const min = typeof f.min === "number" ? f.min : null;
      const max = typeof f.max === "number" ? f.max : null;
      if (min != null || max != null) filters.push({ property: prop.name, op: "range", min, max });
    } else if (f.op === "in" && Array.isArray(f.values)) {
      const allowed = new Map(prop.options.map((o) => [o.value.toLowerCase(), o.value]));
      const values = (f.values as unknown[]).map((v) => allowed.get(String(v).toLowerCase())).filter((v): v is string => !!v);
      if (values.length) filters.push({ property: prop.name, op: "in", values });
    }
  }
  return filters;
}

const LEMLIST_FILTER_TOOL: Anthropic.Tool = {
  name: "set_filters",
  description: "Define los filtros de búsqueda en la base de Lemlist",
  input_schema: {
    type: "object",
    properties: {
      filters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            filterId: { type: "string" },
            in: { type: "array", items: { type: "string" } },
            out: { type: "array", items: { type: "string" } },
          },
          required: ["filterId"],
        },
      },
    },
    required: ["filters"],
  },
};

export async function icpToLemlistFilters(
  db: SupabaseClient,
  clientId: string,
  icpText: string,
  defs: LemlistFilterDef[]
): Promise<LemlistFilter[]> {
  const catalog = defs
    .map((d) =>
      `- ${d.filterId} (${d.description}) — tipo ${d.type}` +
      (d.values?.length ? `, valores: ${d.values.slice(0, MAX_OPTIONS_IN_PROMPT).join(" | ")}` : ", texto libre")
    )
    .join("\n");
  const hint =
    "Notas para Lemlist: usa semanticSearch con UNA frase en inglés que describa la empresa ideal (ej. \"B2B SaaS for logistics teams\"). " +
    "Para filtros select copia valores exactos de la lista. Para autocomplete (ej. país) usa nombres en inglés (\"Chile\", \"Mexico\", \"Brazil\"). " +
    "Incluye siempre al menos un filtro.\n";
  const raw = await runFilterTool(db, clientId, LEMLIST_FILTER_TOOL, "portal_wishlist_icp_filters_lemlist", icpText, hint + catalog);

  const byId = new Map(defs.map((d) => [d.filterId, d]));
  const filters: LemlistFilter[] = [];
  for (const f of raw) {
    const def = byId.get(String(f.filterId));
    if (!def) continue;
    const clean = (list: unknown) => {
      if (!Array.isArray(list)) return [];
      const vals = list.map(String).filter(Boolean);
      if (!def.values?.length) return vals;
      const allowed = new Map(def.values.map((v) => [v.toLowerCase(), v]));
      return vals.map((v) => allowed.get(v.toLowerCase())).filter((v): v is string => !!v);
    };
    const inVals = clean(f.in);
    const outVals = clean(f.out);
    if (inVals.length || outVals.length) filters.push({ filterId: def.filterId, in: inVals, out: outVals });
  }
  return filters;
}
