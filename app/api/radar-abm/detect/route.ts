import { NextRequest, NextResponse } from "next/server";
import { detectProperties, loadPropertyCatalog } from "@/lib/radarAbm/server/hubspot";
import { hubspotTokenFor, loadClientSettings, loadRadarConfig } from "@/lib/radarAbm/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Detecta en HubSpot el nombre interno de cada propiedad del Radar ABM por
// su etiqueta (Anexo A1) y devuelve los valores de las enumeraciones (por
// ejemplo, los clientes de "Cliente BullsEye"). Con ?client_id= usa el
// HubSpot que corresponde a ese cliente; sin él, el de BullsEye.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const clientId = req.nextUrl.searchParams.get("client_id") ?? "";
    let token: string | undefined;
    if (UUID_RE.test(clientId)) {
      const settings = await loadClientSettings(clientId);
      token = await hubspotTokenFor(clientId, settings.hubspot_source);
    }
    const cfg = await loadRadarConfig();
    const { catalog, errors } = await loadPropertyCatalog(token);
    if (errors.length && !Object.values(catalog).some((v) => v.length)) {
      return NextResponse.json({ error: errors[0] }, { status: 502 });
    }
    return NextResponse.json({ properties: detectProperties(cfg.properties, catalog), warnings: errors });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
