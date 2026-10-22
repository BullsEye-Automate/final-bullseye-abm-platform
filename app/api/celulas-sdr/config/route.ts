import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { supabaseServer } from "@/lib/supabase/server";
import { DEFAULT_CONFIG } from "@/lib/celulasSdr/types";
import { sanitizeConfig as sanitize } from "@/lib/celulasSdr/server/config";

export const dynamic = "force-dynamic";

// Parámetros globales de "Configurar" del módulo Células SDR (tabla
// sdr_cells_config, ver supabase/20261016_sdr_cells_config.sql). Una sola
// fila (id = 'global'); cualquier usuario con sesión puede editarlos.

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin().from("sdr_cells_config").select("config, updated_by, updated_at").eq("id", "global").maybeSingle();
    if (error) {
      // Tabla aún no creada: se trabaja con los valores por defecto.
      return NextResponse.json({ config: DEFAULT_CONFIG, updated_by: null, updated_at: null, warning: error.message });
    }
    return NextResponse.json({ config: sanitize(data?.config), updated_by: data?.updated_by ?? null, updated_at: data?.updated_at ?? null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const config = sanitize(body?.config);
    let updatedBy: string | null = null;
    try {
      const { data } = await supabaseServer().auth.getUser();
      updatedBy = data.user?.email ?? null;
    } catch {
      // sin sesión legible: se guarda igual (la ruta ya está protegida por middleware)
    }
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin()
      .from("sdr_cells_config")
      .upsert({ id: "global", config, updated_by: updatedBy, updated_at: now }, { onConflict: "id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ config, updated_by: updatedBy, updated_at: now });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
