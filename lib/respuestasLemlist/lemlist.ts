import type { SupabaseClient } from "@supabase/supabase-js";
import { getLemlistApiKey } from "@/lib/lemlistKey";
import { listAllLemlistCampaigns, pick, type LemlistCampaignRef } from "@/lib/lemlist";

// Respuestas Lemlist → SDR: lectura de respuestas (email y LinkedIn) y pausa
// de leads. Se consulta por campaña (no por webhook) porque varios clientes
// comparten la cuenta de Lemlist de BullsEye: la campaña dice de qué cliente es.

export type LemlistReply = {
  activityId: string;
  channel: "email" | "linkedin";
  campaignId: string;
  campaignName: string;
  leadEmail: string;
  leadName: string;
  companyName: string;
  text: string;
  createdAt: string | null;
};

const REPLY_TYPES: { type: string; channel: LemlistReply["channel"] }[] = [
  { type: "emailsReplied", channel: "email" },
  { type: "linkedinReplied", channel: "linkedin" },
];

const creds = (apiKey: string) => `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`;

// Campañas del cliente: las asignadas en Config. cliente (client_lemlist_campaigns
// + campaña principal). Si el cliente tiene su propia cuenta de Lemlist y no
// asignó campañas, se leen todas las de su cuenta (son todas suyas). Con la key
// compartida de BullsEye y sin campañas asignadas no se lee nada (se mezclarían clientes).
export async function clientReplySources(db: SupabaseClient, clientId: string): Promise<{ apiKey: string | null; campaigns: LemlistCampaignRef[]; ownKey: boolean; warning?: string }> {
  const [{ data: cfg }, { data: mapped }] = await Promise.all([
    db.from("client_configs").select("lemlist_api_key, lemlist_campaign_id").eq("client_id", clientId).maybeSingle(),
    db.from("client_lemlist_campaigns").select("campaign_id, campaign_name, is_active").eq("client_id", clientId),
  ]);
  const ownKey = !!((cfg as { lemlist_api_key?: string | null } | null)?.lemlist_api_key ?? "").trim();
  const apiKey = await getLemlistApiKey(db, clientId);
  const byId = new Map<string, LemlistCampaignRef>();
  for (const m of (mapped ?? []) as { campaign_id: string; campaign_name: string | null; is_active: boolean | null }[]) {
    if (m.is_active === false) continue;
    byId.set(m.campaign_id, { id: m.campaign_id, name: m.campaign_name ?? m.campaign_id });
  }
  const main = (cfg as { lemlist_campaign_id?: string | null } | null)?.lemlist_campaign_id;
  if (main && !byId.has(main)) byId.set(main, { id: main, name: main });
  if (!apiKey) return { apiKey: null, campaigns: [], ownKey, warning: "Sin API key de Lemlist." };
  if (!byId.size && ownKey) {
    const all = await listAllLemlistCampaigns(apiKey);
    return { apiKey, campaigns: all, ownKey };
  }
  if (!byId.size) return { apiKey, campaigns: [], ownKey, warning: "Usa la cuenta de Lemlist de BullsEye y no tiene campañas asignadas en Config. cliente." };
  return { apiKey, campaigns: Array.from(byId.values()), ownKey };
}

// Respuestas recientes de una campaña (las 100 últimas de cada tipo)
export async function fetchCampaignReplies(campaign: LemlistCampaignRef, apiKey: string): Promise<LemlistReply[]> {
  const out: LemlistReply[] = [];
  for (const { type, channel } of REPLY_TYPES) {
    const res = await fetch(
      `https://api.lemlist.com/api/activities?type=${type}&campaignId=${encodeURIComponent(campaign.id)}&limit=100`,
      { headers: { Authorization: creds(apiKey) } }
    ).catch(() => null);
    if (!res?.ok) continue;
    const data = await res.json().catch(() => null);
    const items: Record<string, unknown>[] = Array.isArray(data) ? data : ((data as any)?.data ?? (data as any)?.activities ?? []);
    for (const a of items) {
      const id = pick(a, "_id", "id");
      const email = pick(a, "leadEmail", "email").toLowerCase();
      if (!id || !email) continue;
      out.push({
        activityId: id,
        channel,
        campaignId: campaign.id,
        campaignName: pick(a, "campaignName") || campaign.name,
        leadEmail: email,
        leadName: [pick(a, "leadFirstName", "firstName"), pick(a, "leadLastName", "lastName")].filter(Boolean).join(" "),
        companyName: pick(a, "leadCompanyName", "companyName"),
        text: pick(a, "text", "message", "messagePreview", "body", "snippet").slice(0, 4000),
        createdAt: (a.createdAt as string) ?? (a.date as string) ?? null,
      });
    }
  }
  return out;
}

// Pausa el lead en la campaña de la respuesta (no recibe más follow-ups)
export async function pauseLead(apiKey: string, campaignId: string, email: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(
    `https://api.lemlist.com/api/leads/pause/${encodeURIComponent(email)}?campaignId=${encodeURIComponent(campaignId)}`,
    { method: "POST", headers: { Authorization: creds(apiKey) } }
  ).catch(() => null);
  if (res?.ok) return { ok: true };
  const text = await res?.text().catch(() => "");
  return { ok: false, error: `Lemlist ${res?.status ?? "sin respuesta"}: ${(text ?? "").slice(0, 150)}` };
}
