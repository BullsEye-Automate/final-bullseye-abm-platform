import { NextRequest, NextResponse } from "next/server";
import { getReviewerEmail } from "@/lib/portalAdmin";
import { supabaseAdmin } from "@/lib/supabase";
import { masterStatusFor } from "@/lib/radarAbm/server/masterClients";
import { PROPERTY_DEFS } from "@/lib/radarAbm/dictionaries";
import { loadClientSettings, loadSnapshot, saveClientSettings, type RadarClientSettings } from "@/lib/radarAbm/server/store";

export const dynamic = "force-dynamic";

// Radar ABM — configuración del cliente (Configuración → Cliente → Radar ABM):
// de qué HubSpot se lee, valor de "Cliente BullsEye" y si se muestra en el
// portal. Requiere sesión interna (middleware).

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { data: client } = await supabaseAdmin().from("clients").select("id, name, slug").eq("id", params.id).maybeSingle();
    const [settings, snapshot, master] = await Promise.all([
      loadClientSettings(params.id),
      loadSnapshot(params.id),
      client ? masterStatusFor(client) : Promise.resolve({ active: false, text: "Cliente no encontrado" }),
    ]);
    return NextResponse.json({ settings, syncedAt: snapshot?.synced_at ?? null, stats: snapshot?.stats ?? null, warnings: snapshot?.warnings ?? [], master });
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
      // Mapeo propio (HubSpot del cliente): solo claves conocidas y nombres
      // internos válidos (letras, números y guion bajo)
      properties: Object.fromEntries(
        Object.entries((b.properties ?? {}) as Record<string, unknown>)
          .filter(([k, v]) => PROPERTY_DEFS.some((d) => d.key === k) && typeof v === "string" && /^[a-z0-9_]+$/i.test(v.trim()))
          .map(([k, v]) => [k, (v as string).trim()])
      ),
    };
    await saveClientSettings(settings, await getReviewerEmail());
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
