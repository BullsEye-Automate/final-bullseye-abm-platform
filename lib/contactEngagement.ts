// Helpers para determinar el estado de engagement de un contacto en el funnel.

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
