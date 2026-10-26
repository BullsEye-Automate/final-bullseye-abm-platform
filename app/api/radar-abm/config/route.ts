import { NextRequest, NextResponse } from "next/server";
import { getReviewerEmail } from "@/lib/portalAdmin";
import { DEFAULT_CONFIG, HEALTH_COMPONENTS, PROPERTY_DEFS, mergeConfig } from "@/lib/radarAbm/dictionaries";
import { loadRadarConfig, saveRadarConfig } from "@/lib/radarAbm/server/store";

export const dynamic = "force-dynamic";

// Configuración global del Radar ABM (tabla radar_abm_config): metas y pesos
// del Health Score, tramos de tamaño, tabla de cargos y mapeo de propiedades
// de HubSpot. Cualquier usuario interno puede editarla.

export async function GET() {
  try {
    return NextResponse.json({ config: await loadRadarConfig(), defaults: DEFAULT_CONFIG, components: HEALTH_COMPONENTS, propertyDefs: PROPERTY_DEFS });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const cfg = mergeConfig(body?.config);
    // Solo nombres internos válidos (letras, números y guion bajo)
    cfg.properties = Object.fromEntries(
      Object.entries(cfg.properties)
        .filter(([k, v]) => PROPERTY_DEFS.some((d) => d.key === k) && typeof v === "string" && /^[a-z0-9_]*$/i.test(v.trim()))
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v)
    );
    cfg.titleRules = cfg.titleRules
      .filter((r) => r && typeof r.kw === "string" && r.kw.trim() && (r.area || r.sen))
      .map((r) => ({ kw: r.kw.trim(), ...(r.area ? { area: String(r.area) } : {}), ...(r.sen ? { sen: String(r.sen) } : {}) }));
    await saveRadarConfig(cfg, await getReviewerEmail());
    return NextResponse.json({ config: cfg });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
