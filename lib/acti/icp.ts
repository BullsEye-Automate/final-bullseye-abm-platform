import type { SupabaseClient } from "@supabase/supabase-js";
import { deserializeIcpForm, diffIcpContent, EMPTY_FORM, serializeIcpForm, type IcpFormData } from "@/lib/icp-form";
import { loadIcpContent, saveIcpContent } from "@/lib/icpStore";

// ACTI · Mi ICP y Mi perfil comercial. Es EL MISMO ICP de Sistema → ICP
// (client_ai_context, file_type = 'icp'): se lee y escribe con icpStore, no
// hay copia. El socio ACTI lo edita directo (decisión de BullsEye 27-nov-2026,
// solo para clientes ACTI; el resto sigue con propuesta y aprobación).

// ── Buyer personas adicionales ──────────────────────────────────────────
// La persona principal son los campos de siempre (cargos decisores,
// departamentos, seniority…). Las adicionales se guardan como texto legible
// en el campo "Buyer personas adicionales" para que la IA (fit, Contactos IA)
// las lea igual que el resto del ICP.

export type ExtraPersona = { name: string; area: string; level: string; titles: string; pains: string };

const FIELDS: [keyof ExtraPersona, string][] = [
  ["area", "Área"],
  ["level", "Nivel"],
  ["titles", "Cargos"],
  ["pains", "Dolores"],
];

// Una línea por campo; sin "[" al inicio de línea ni "---" (cortarían el campo del ICP)
const clean = (s: string) => s.replace(/\s*\n\s*/g, " ").replace(/^\[/, "(").replace(/-{3,}/g, "—").trim().slice(0, 600);

export function encodePersonas(list: ExtraPersona[]): string {
  return list
    .filter((p) => p.name.trim() || p.titles.trim())
    .map((p, i) => {
      const lines = [`Persona ${i + 2}: ${clean(p.name) || "Sin nombre"}`];
      for (const [k, label] of FIELDS) if (p[k].trim()) lines.push(`- ${label}: ${clean(p[k])}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function decodePersonas(text: string | undefined): ExtraPersona[] {
  if (!text?.trim()) return [];
  return text
    .split(/\n\s*\n(?=Persona \d+:)|^(?=Persona \d+:)/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [head, ...rest] = block.split("\n");
      const p: ExtraPersona = { name: head.replace(/^Persona \d+:\s*/, "").trim(), area: "", level: "", titles: "", pains: "" };
      for (const line of rest) {
        const m = line.match(/^-\s*([^:]+):\s*(.*)$/);
        if (!m) continue;
        const f = FIELDS.find(([, label]) => label.toLowerCase() === m[1].trim().toLowerCase());
        if (f) p[f[0]] = m[2].trim();
      }
      return p;
    });
}

// ── Campos que edita el socio ────────────────────────────────────────────

// Mi ICP: empresa objetivo, señales, buyer persona y clientes de referencia
export const ICP_KEYS = [
  "descripcion_negocio",
  "industrias_objetivo", "industrias_excluidas", "tamano_empresa", "facturacion", "geografias", "modelo_empresa", "etapa_empresa", "regulaciones",
  "senales_positivas", "senales_negativas", "tech_stack", "eventos_disparadores",
  "cargos_decisores", "cargos_influenciadores", "cargos_evitar", "departamentos", "seniority", "perfil_psicografico", "buyer_personas_extra",
  "mejores_clientes", "peores_clientes", "ticket_acv",
] as const satisfies readonly (keyof IcpFormData)[];

// Mi perfil comercial: lo que usan el SDR y Peitho
export const PROFILE_KEYS = [
  "propuesta_valor", "servicios", "problemas", "resultados", "casos_exito", "diferenciadores", "competidores", "objeciones", "no_ofrecer",
] as const satisfies readonly (keyof IcpFormData)[];

export type IcpScope = "icp" | "perfil";
const keysFor = (scope: IcpScope): readonly (keyof IcpFormData)[] => (scope === "icp" ? ICP_KEYS : PROFILE_KEYS);
const ARRAY_KEYS = new Set((Object.keys(EMPTY_FORM) as (keyof IcpFormData)[]).filter((k) => Array.isArray(EMPTY_FORM[k])));

export class ActiIcpError extends Error {}

async function icpMode(db: SupabaseClient, clientId: string): Promise<string> {
  const { data } = await db.from("client_configs").select("icp_mode").eq("client_id", clientId).maybeSingle();
  return (data?.icp_mode as string | undefined) ?? "general";
}

export async function loadActiIcp(db: SupabaseClient, clientId: string) {
  const text = await loadIcpContent(db, clientId, null);
  return { form: text ? deserializeIcpForm(text) : { ...EMPTY_FORM }, byIndustry: (await icpMode(db, clientId)) === "by_industry" };
}

// Mezcla solo los campos del alcance (ICP o perfil) sobre el ICP vigente y lo
// guarda. Los demás campos no se tocan. Devuelve los campos que cambiaron.
export async function saveActiIcp(db: SupabaseClient, clientId: string, scope: IcpScope, input: Record<string, unknown>, by: string) {
  if ((await icpMode(db, clientId)) === "by_industry") {
    throw new ActiIcpError("Tu ICP está organizado por industria. Pídele al equipo de BullsEye que lo actualice.");
  }
  const before = await loadIcpContent(db, clientId, null);
  const form: IcpFormData = before ? deserializeIcpForm(before) : { ...EMPTY_FORM };
  for (const key of keysFor(scope)) {
    if (!(key in input)) continue;
    const v = input[key];
    if (ARRAY_KEYS.has(key)) {
      (form as Record<string, unknown>)[key] = Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 100)).filter(Boolean).slice(0, 30)
        : [];
    } else {
      (form as Record<string, unknown>)[key] = typeof v === "string" ? v.replace(/^\[/gm, "(").replace(/^-{3,}/gm, "—").slice(0, 4000) : "";
    }
  }
  const after = serializeIcpForm(form);
  const changes = diffIcpContent(before, after);
  if (!changes.length) return { changes: [] as string[] };

  // Respaldo del ICP anterior (mismo esquema que el Centro de prospección)
  const stamp = new Date().toISOString();
  await db.from("allo_response_cache").upsert({
    cache_key: `icp_respaldo:${clientId}:general:${stamp}`,
    response: { seccion: "General", contenido: before, por: by, fuente: `acti:${scope}`, at: stamp },
    expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
  }, { onConflict: "cache_key" });

  const { error } = await saveIcpContent(db, clientId, null, after);
  if (error) throw new ActiIcpError(`No se pudo guardar: ${error}`);
  return { changes: changes.map((c) => c.label) };
}
