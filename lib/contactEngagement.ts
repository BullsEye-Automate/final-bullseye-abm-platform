// Helpers para determinar el estado de engagement de un contacto en el funnel.
import type { SupabaseClient } from "@supabase/supabase-js";

export type EngagementStatus =
  | "pending"
  | "enriched"
  | "in_lemlist"
  | "in_hubspot"
  | "contacted"
  | "replied"
  | "discarded";

export type ContactEngagementSummary = {
  status: string;
  lemlist_pushed_at: string | null;
  hubspot_synced_at: string | null;
  lemlist_lead_id: string | null;
  hubspot_contact_id: string | null;
};

/**
 * Retorna una descripción textual del estado de engagement de un contacto.
 */
export function describeEngagement(c: ContactEngagementSummary): string {
  if (c.status === "replied") return "Respondió";
  if (c.status === "contacted") return "Contactado";
  if (c.hubspot_contact_id) return "En HubSpot";
  if (c.lemlist_lead_id || c.lemlist_pushed_at) return "En Lemlist";
  if (c.status === "enriched") return "Enriquecido";
  if (c.status === "discarded") return "Descartado";
  return "Pendiente";
}

/**
 * Determina si el contacto ya fue empujado a Lemlist.
 */
export function isInLemlist(c: {
  lemlist_lead_id?: string | null;
  lemlist_pushed_at?: string | null;
}): boolean {
  return !!(c.lemlist_lead_id || c.lemlist_pushed_at);
}

/**
 * Determina si el contacto ya fue sincronizado con HubSpot.
 */
export function isInHubSpot(c: {
  hubspot_contact_id?: string | null;
  hubspot_synced_at?: string | null;
}): boolean {
  return !!(c.hubspot_contact_id || c.hubspot_synced_at);
}

export type EngagementScoreResult = {
  score: number;
  last_activity_at: string | null;
};

/**
 * Calcula un puntaje de engagement basado en la actividad del contacto.
 * Puntaje 0-100: lemlist_pushed_at (+40), hubspot_synced_at (+30), status enriched/contacted/replied (+30).
 */
export async function computeEngagementScore(
  db: SupabaseClient,
  contactId: string
): Promise<EngagementScoreResult> {
  const { data } = await db
    .from("contacts")
    .select("status, lemlist_pushed_at, hubspot_synced_at, updated_at")
    .eq("id", contactId)
    .maybeSingle();

  if (!data) return { score: 0, last_activity_at: null };

  let score = 0;
  const timestamps: string[] = [];

  if (data.lemlist_pushed_at) { score += 40; timestamps.push(data.lemlist_pushed_at); }
  if (data.hubspot_synced_at) { score += 30; timestamps.push(data.hubspot_synced_at); }
  if (data.status === "replied") score += 30;
  else if (data.status === "contacted") score += 20;
  else if (data.status === "enriched") score += 10;

  if (data.updated_at) timestamps.push(data.updated_at);

  const last_activity_at = timestamps.length > 0
    ? timestamps.sort().reverse()[0]
    : null;

  return { score: Math.min(100, score), last_activity_at };
}
