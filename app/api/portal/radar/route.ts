import { NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portalAuth";
import { loadClientSettings, loadRadarConfig, loadSnapshot } from "@/lib/radarAbm/server/store";

export const dynamic = "force-dynamic";

// Radar ABM en el portal de clientes. El client_id sale SIEMPRE de
// client_users (requirePortalUser), así cada usuario ve solo su cuenta.
// Solo se muestran datos reales sincronizados desde HubSpot: los datos demo
// nunca llegan al portal. Las advertencias internas del sync y el mapeo de
// propiedades (anexo de validación) no se envían al cliente.

export async function GET() {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  try {
    const [settings, snapshot, config] = await Promise.all([loadClientSettings(user.clientId), loadSnapshot(user.clientId), loadRadarConfig()]);
    if (!settings.portal_enabled) return NextResponse.json({ dataset: null, reason: "disabled" });
    if (!snapshot) return NextResponse.json({ dataset: null, reason: "pending" });
    const { warnings: _w, mapping: _m, ...dataset } = snapshot.dataset;
    // Al cliente solo lo que necesita el cálculo (sin mapeo de propiedades)
    return NextResponse.json({ dataset, config: { ...config, properties: {}, contactAliases: {} } });
  } catch (err) {
    console.error("Radar ABM (portal):", err);
    return NextResponse.json({ error: "No se pudo cargar el informe" }, { status: 500 });
  }
}
