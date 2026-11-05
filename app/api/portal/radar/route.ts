import { NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portalAuth";
import { isPortalClientActive } from "@/lib/radarAbm/server/masterClients";
import { loadClientSettings, loadRadarConfig, loadSnapshot, subAccounts } from "@/lib/radarAbm/server/store";
import { loadFeedbackOverlay } from "@/lib/radarAbm/server/sheetMeetings";

export const dynamic = "force-dynamic";

// Pulso ABM en el portal de clientes. El client_id sale SIEMPRE de
// client_users (requirePortalUser), así cada usuario ve solo su cuenta.
// Solo se muestran datos reales sincronizados desde HubSpot: los datos demo
// nunca llegan al portal. Las advertencias internas del sync y el mapeo de
// propiedades (anexo de validación) no se envían al cliente.

export async function GET() {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  try {
    const [settings, snapshot, config] = await Promise.all([loadClientSettings(user.clientId), loadSnapshot(user.clientId, "url"), loadRadarConfig()]);
    // Feedback del cliente en vivo (lo que acaba de completar se ve sin esperar al sync)
    const feedback = snapshot ? await loadFeedbackOverlay(user.clientId, subAccounts(settings)).catch(() => ({})) : {};
    if (!settings.portal_enabled) return NextResponse.json({ dataset: null, reason: "disabled" });
    // Solo clientes activos en la Maestra
    if (!(await isPortalClientActive(user.clientId, user.clientName))) return NextResponse.json({ dataset: null, reason: "disabled" });
    if (!snapshot) return NextResponse.json({ dataset: null, reason: "pending" });
    const safeConfig = { ...config, properties: {}, contactAliases: {}, companyAliases: {} };
    // Informe en Storage: el archivo no lleva avisos internos ni mapeo de propiedades
    if (snapshot.datasetUrl) {
      // Varios clientes en la cuenta: solo nombre y link de cada informe (sin avisos internos ni mapeo)
      const subs = snapshot.subs?.map((x) => ({ name: x.name, url: x.url }));
      return NextResponse.json({ dataset: null, datasetUrl: snapshot.datasetUrl, config: safeConfig, feedback, ...(subs?.length ? { subs } : {}) });
    }
    const { warnings: _w, mapping: _m, ...dataset } = snapshot.dataset;
    // Al cliente solo lo que necesita el cálculo (sin mapeo de propiedades)
    return NextResponse.json({ dataset, config: safeConfig, feedback });
  } catch (err) {
    console.error("Pulso ABM (portal):", err);
    return NextResponse.json({ error: "No se pudo cargar el informe" }, { status: 500 });
  }
}
