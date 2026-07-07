import type { SupabaseClient } from "@supabase/supabase-js";

// Lemlist no expone una fecha confiable de "cuándo se agregó este lead a
// ESTA campaña" (ver nota en lib/lemlist.ts). Como fuente de verdad propia,
// registramos la primera vez que la app ve cada lead en cada campaña y
// usamos esa fecha para el filtro de "desde/hasta" en /busqueda-manual —
// funciona incluso cuando el contacto ya existía en Lemlist de antes (ej.
// por lookup-phone), caso en el que contact.createdAt sale viejo aunque el
// lead se haya agregado a la Campaña puente recién hoy.
export async function recordAndResolveFirstSeen(
  db: SupabaseClient,
  campaignId: string,
  leadIds: string[]
): Promise<Map<string, string>> {
  if (!leadIds.length) return new Map();

  const rows = leadIds.map((id) => ({ campaign_id: campaignId, lemlist_lead_id: id }));
  await db
    .from("lemlist_lead_first_seen")
    .upsert(rows, { onConflict: "campaign_id,lemlist_lead_id", ignoreDuplicates: true });

  const { data } = await db
    .from("lemlist_lead_first_seen")
    .select("lemlist_lead_id, first_seen_at")
    .eq("campaign_id", campaignId)
    .in("lemlist_lead_id", leadIds);

  return new Map((data ?? []).map((r) => [r.lemlist_lead_id, r.first_seen_at as string]));
}
