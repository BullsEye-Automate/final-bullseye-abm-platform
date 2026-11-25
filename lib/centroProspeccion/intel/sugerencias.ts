import type { SupabaseClient } from "@supabase/supabase-js";

// La Inteligencia de la semana NO cambia el ICP del cliente (pedido de
// BullsEye, 25-nov-2026): son sugerencias para presentarle al cliente. El ICP
// solo cambia cuando se acuerda formalmente (reunión o correo) y se modifica
// en el proyecto de Claude del cliente. Por eso, al aprobar una propuesta ya
// no se anota en los campos de criterio de la ficha (Industrias, Zonas,
// Cargos, Exclusiones, Perfil): queda guardada en centro_intel y se lista en
// la ficha como «Sugerencias para presentar al cliente».

export const INTEL_LINE = /\(inteligencia semana [^)]*\)/i;
const AJUSTES_HDR = /^ajustes aprobados en el centro/i;

// Campos de criterio de la ficha de los que se quitan las líneas de la inteligencia
export const CRITERIA_FIELDS = ["icp", "industrias", "zonas", "cargos", "exclusiones"] as const;

/** Quita de un campo de la ficha las líneas aprobadas desde la inteligencia y el encabezado del bloque. */
export function stripIntelLines(v: unknown): string {
  const lines = String(v ?? "").split("\n");
  const out: string[] = [];
  let inBlock = false;
  for (const l of lines) {
    const t = l.trim();
    if (AJUSTES_HDR.test(t)) { inBlock = true; continue; }
    if (t.startsWith("•") && INTEL_LINE.test(t)) continue;
    // Dentro del bloque solo había viñetas de la inteligencia (o notas del equipo sobre ellas)
    if (inBlock && t.startsWith("•")) continue;
    if (inBlock && t) inBlock = false;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type Sugerencia = { semana: string; id: string; tipo: string; campo: string; texto: string; evidencia: string; casos: number; toca_icp: boolean; decidido_por: string | null; decidido_at: string | null };

/** Propuestas aprobadas de todas las semanas de un cliente (las más nuevas primero). */
export async function loadSugerencias(db: SupabaseClient, clientId: string): Promise<Sugerencia[]> {
  const { data, error } = await db.from("centro_intel").select("semana, result").eq("client_id", clientId).order("semana", { ascending: false }).limit(52);
  if (error) throw new Error(error.message);
  const out: Sugerencia[] = [];
  for (const r of (data ?? []) as { semana: string; result: { propuestas?: Record<string, unknown>[] } | null }[]) {
    for (const p of r.result?.propuestas ?? []) {
      if (p.estado !== "aprobada" || p.campo === "proximos") continue;
      out.push({
        semana: r.semana, id: String(p.id), tipo: String(p.tipo ?? ""), campo: String(p.campo ?? ""), texto: String(p.texto ?? ""),
        evidencia: String(p.evidencia ?? ""), casos: Number(p.casos ?? 0), toca_icp: !!p.toca_icp,
        decidido_por: (p.decidido_por as string) ?? null, decidido_at: (p.decidido_at as string) ?? null,
      });
    }
  }
  return out;
}
