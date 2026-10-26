import { NextRequest, NextResponse } from "next/server";
import { getReviewerEmail } from "@/lib/portalAdmin";
import { loadClientSettings, loadSnapshot, saveClientSettings, type RadarClientSettings } from "@/lib/radarAbm/server/store";

export const dynamic = "force-dynamic";

// Radar ABM — configuración del cliente (Configuración → Cliente → Radar ABM):
// de qué HubSpot se lee, valor de "Cliente BullsEye" y si se muestra en el
// portal. Requiere sesión interna (middleware).

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [settings, snapshot] = await Promise.all([loadClientSettings(params.id), loadSnapshot(params.id)]);
    return NextResponse.json({ settings, syncedAt: snapshot?.synced_at ?? null, stats: snapshot?.stats ?? null, warnings: snapshot?.warnings ?? [] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const b = await req.json().catch(() => ({}));
    const triState = (v: unknown) => (v === true ? true : v === false ? false : null);
    const settings: RadarClientSettings = {
      client_id: params.id,
      hubspot_source: b.hubspot_source === "client" ? "client" : "bullseye",
      hubspot_client_value: typeof b.hubspot_client_value === "string" && b.hubspot_client_value.trim() ? b.hubspot_client_value.trim().slice(0, 200) : null,
      deep: triState(b.deep),
      pipeline: triState(b.pipeline),
      portal_enabled: b.portal_enabled !== false,
    };
    await saveClientSettings(settings, await getReviewerEmail());
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
