// Multi-tenant: primero intenta client_configs.lemlist_campaign_id, cae en env var.
import type { SupabaseClient } from "@supabase/supabase-js";

export function getLemlistCampaignIds(): string[] {
  const raw = process.env.LEMLIST_CAMPAIGN_ID ?? "";
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

export function getPrimaryLemlistCampaignId(): string | null {
  const ids = getLemlistCampaignIds();
  return ids.length > 0 ? ids[0] : null;
}

// Multi-tenant: obtiene el campaign ID para un cliente específico desde client_configs.
// Cae en env var si no se encuentra.
export async function getClientLemlistCampaignId(
  db: SupabaseClient,
  clientId: string | null | undefined
): Promise<string | null> {
  if (clientId) {
    const { data } = await db
      .from("client_configs")
      .select("lemlist_campaign_id")
      .eq("client_id", clientId)
      .maybeSingle();
    if (data?.lemlist_campaign_id) return data.lemlist_campaign_id;
  }
  return getPrimaryLemlistCampaignId();
}
