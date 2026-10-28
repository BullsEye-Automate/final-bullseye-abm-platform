import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { detectProperties, loadPropertyCatalog } from "@/lib/radarAbm/server/hubspot";
import { effectiveProperties, hubspotTokenFor, loadClientSettings, loadRadarConfig, type RadarClientSettings } from "@/lib/radarAbm/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Detecta en HubSpot el nombre interno de cada propiedad del Pulso ABM por
// su etiqueta (Anexo A1) y devuelve los valores de las enumeraciones (por
// ejemplo, los clientes de "Cliente BullsEye"). Con ?client_id= usa el
// HubSpot que corresponde a ese cliente; sin él, el de BullsEye.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const clientId = req.nextUrl.searchParams.get("client_id") ?? "";
    let token: string | undefined;
    let settings: RadarClientSettings | null = null;
    let clientName: string | null = null;
    if (UUID_RE.test(clientId)) {
      settings = await loadClientSettings(clientId);
      const { data } = await supabaseAdmin().from("clients").select("name").eq("id", clientId).maybeSingle();
      clientName = data?.name ?? null;
      token = await hubspotTokenFor(clientId, settings.hubspot_source);
    }
    const cfg = await loadRadarConfig();
    const mapping = settings ? effectiveProperties(cfg, settings) : cfg.properties;
    const { catalog, errors } = await loadPropertyCatalog(token);
    if (errors.length && !Object.values(catalog).some((v) => v.length)) {
      return NextResponse.json({ error: errors[0] }, { status: 502 });
    }
    return NextResponse.json({ properties: detectProperties(mapping, catalog, clientName), warnings: errors });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
