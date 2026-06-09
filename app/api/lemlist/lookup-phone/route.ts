import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { searchHSContactByLinkedinUrl, patchHSContact } from "@/lib/hubspot";

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

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });

  const db = supabaseAdmin();
  const { data: config } = await db
    .from("client_configs")
    .select("lemlist_staging_campaign_id")
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

  // Push del lead a la staging con findPhone activado
  const pushRes = await fetch(
    `https://api.lemlist.com/api/campaigns/${campaignId}/leads?findEmail=true&verifyEmail=true&findPhone=true&linkedinEnrichment=true&deduplicate=true`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
      body: JSON.stringify({ linkedinUrl }),
    }
  ).catch(() => null);

  if (!pushRes || (!pushRes.ok && pushRes.status !== 409)) {
    const t = await pushRes?.text().catch(() => "");
    return NextResponse.json({ error: `Lemlist staging ${pushRes?.status}: ${(t ?? "").slice(0, 200)}` }, { status: 502 });
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
