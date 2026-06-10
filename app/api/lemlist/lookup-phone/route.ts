import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { searchHSContactByLinkedinUrl, patchHSContact } from "@/lib/hubspot";
import { getLemlistApiKey } from "@/lib/lemlistKey";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/lemlist/lookup-phone
// Body: { client_id, linkedin_url }
// Empuja el LinkedIn URL a la campaña staging con findPhone=true,
// hace polling hasta 30s, y devuelve { found, phone } o timeout.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const clientId = body.client_id as string | undefined;
  const linkedinUrl = (body.linkedin_url ?? "").toString().trim();

  if (!clientId || !linkedinUrl) {
    return NextResponse.json({ error: "Se requiere client_id y linkedin_url" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const apiKey = await getLemlistApiKey(db, clientId);
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });
  const { data: config } = await db
    .from("client_configs")
    .select("lemlist_staging_campaign_id, lemlist_campaign_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!config?.lemlist_staging_campaign_id) {
    return NextResponse.json(
      { error: "Este cliente no tiene campaña staging configurada (lemlist_staging_campaign_id)" },
      { status: 400 }
    );
  }

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const campaignId  = config.lemlist_staging_campaign_id;
  const mainCampaignId = config.lemlist_campaign_id ?? null;

  const targetNorm = (normalizeLinkedInUrl(linkedinUrl) ?? linkedinUrl).toLowerCase();

  // Extrae teléfono de un lead probando múltiples claves donde Lemlist guarda el número.
  function extractPhone(lead: any): string | null {
    const candidates = [
      lead?.phone,
      lead?.mobilePhone,
      lead?.mobile_phone,
      lead?.workPhone,
      lead?.work_phone,
      lead?.fields?.phone,
      lead?.fields?.mobilePhone,
      lead?.fields?.mobile_phone,
    ];
    for (const c of candidates) {
      const s = (c ?? "").toString().trim();
      if (s) return s;
    }
    return null;
  }

  // Compara LinkedIn URLs aplicando la misma normalización en ambos lados.
  function sameLinkedin(a: any): boolean {
    const raw = (a?.linkedinUrl ?? a?.linkedin_url ?? a?.linkedin ?? a?.fields?.linkedinUrl ?? "").toString().trim();
    if (!raw) return false;
    const norm = (normalizeLinkedInUrl(raw) ?? raw).toLowerCase();
    return norm === targetNorm;
  }

  // Busca el lead por linkedinUrl en una campaña concreta (paginando hasta 1000 leads) y devuelve teléfono si existe.
  async function lookupPhoneInCampaign(cId: string): Promise<string | null> {
    let offset = 0;
    const limit = 100;
    while (offset < 1000) {
      const listRes = await fetch(
        `https://api.lemlist.com/api/campaigns/${cId}/leads?limit=${limit}&offset=${offset}`,
        { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
      ).catch(() => null);
      if (!listRes?.ok) return null;
      const data = await listRes.json();
      const leads: any[] = Array.isArray(data) ? data : (data.leads ?? data.list ?? []);
      if (!leads.length) return null;
      const match = leads.find(sameLinkedin);
      if (match) return extractPhone(match);
      if (leads.length < limit) return null;
      offset += limit;
    }
    return null;
  }

  // Busca en staging + campaña principal antes de pushear (evita consumir créditos si ya lo tenemos).
  async function findExistingLeadPhone(): Promise<{ phone: string; from: "staging" | "main" } | null> {
    const phoneStaging = await lookupPhoneInCampaign(campaignId);
    if (phoneStaging) return { phone: phoneStaging, from: "staging" };
    if (mainCampaignId) {
      const phoneMain = await lookupPhoneInCampaign(mainCampaignId);
      if (phoneMain) return { phone: phoneMain, from: "main" };
    }
    return null;
  }

  // ANTES de pushear: si el contacto ya está en cualquier campaña con teléfono, devolvemos directo.
  const preExisting = await findExistingLeadPhone();
  if (preExisting?.phone) {
    let hubspot_updated = false;
    try {
      const hsId = await searchHSContactByLinkedinUrl(linkedinUrl).catch(() => null);
      if (hsId) {
        await patchHSContact(hsId, { bullseye_telefono_lemlist: preExisting.phone });
        hubspot_updated = true;
      }
    } catch { /* no bloquear */ }
    return NextResponse.json({
      found: true, phone: preExisting.phone, source: "lemlist", hubspot_updated,
      cached: true,
      message: preExisting.from === "main"
        ? "Contacto ya estaba en la campaña principal — devolvemos su teléfono sin consumir créditos."
        : "Contacto ya estaba en la campaña staging — devolvemos su teléfono sin consumir créditos.",
    });
  }

  // Push del lead a la staging con findPhone activado
  const pushRes = await fetch(
    `https://api.lemlist.com/api/campaigns/${campaignId}/leads?findEmail=true&verifyEmail=true&findPhone=true&linkedinEnrichment=true&deduplicate=true`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
      body: JSON.stringify({ linkedinUrl }),
    }
  ).catch(() => null);

  const pushText = pushRes ? await pushRes.clone().text().catch(() => "") : "";
  const alreadyInCampaign =
    pushRes?.status === 409 ||
    (pushRes?.status === 400 && /already.*campaign|already.*exist/i.test(pushText));

  // Si el lead ya estaba en la campaña, buscar su teléfono actual sin consumir créditos.
  if (alreadyInCampaign) {
    const existing = await findExistingLeadPhone();
    if (existing?.phone) {
      let hubspot_updated = false;
      try {
        const hsId = await searchHSContactByLinkedinUrl(linkedinUrl).catch(() => null);
        if (hsId) {
          await patchHSContact(hsId, { bullseye_telefono_lemlist: existing.phone });
          hubspot_updated = true;
        }
      } catch { /* no bloquear */ }
      return NextResponse.json({
        found: true, phone: existing.phone, source: "lemlist", hubspot_updated,
        cached: true, message: "Contacto ya estaba en la campaña — devolvemos su teléfono sin consumir créditos.",
      });
    }
    // Existía pero sin teléfono cargado en Lemlist
    return NextResponse.json({
      found: false,
      message: "El contacto ya está en la campaña staging pero Lemlist aún no tiene su teléfono. Espera unos minutos y reintenta.",
    });
  }

  if (!pushRes || !pushRes.ok) {
    return NextResponse.json({ error: `Lemlist staging ${pushRes?.status}: ${pushText.slice(0, 200)}` }, { status: 502 });
  }

  // Polling: cada 4s buscar el lead en la campaña y revisar si Lemlist ya levantó teléfono.
  // Máx 20s para no chocar con timeout de la función serverless.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));

    const listRes = await fetch(
      `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=200`,
      { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
    ).catch(() => null);

    if (!listRes?.ok) continue;
    const data = await listRes.json();
    const leads: any[] = Array.isArray(data) ? data : (data.leads ?? data.list ?? []);
    const match = leads.find((l) => (l.linkedinUrl ?? "").trim().toLowerCase() === linkedinUrl.toLowerCase());

    if (match?.phone?.trim()) {
      const phone = match.phone.trim();
      let hubspot_updated = false;
      try {
        const hsId = await searchHSContactByLinkedinUrl(linkedinUrl).catch(() => null);
        if (hsId) {
          await patchHSContact(hsId, { bullseye_telefono_lemlist: phone });
          hubspot_updated = true;
          console.log(`[lemlist-lookup] HubSpot actualizado hsId=${hsId} telefono_lemlist=${phone}`);
        }
      } catch (err: any) {
        console.error("[lemlist-lookup] HubSpot update error:", err?.message);
      }
      return NextResponse.json({ found: true, phone, source: "lemlist", hubspot_updated });
    }
  }

  return NextResponse.json({
    found: false,
    timeout: true,
    message: "Lemlist está procesando la búsqueda. Puede tardar más de 30s; revisa en unos minutos.",
  });
}
