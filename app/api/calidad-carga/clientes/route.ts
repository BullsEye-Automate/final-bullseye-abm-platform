import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { findMasterRow, readMasterClients } from "@/lib/radarAbm/server/masterClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clientes del resumen de Calidad de carga (vista "Todos los clientes"):
// los activos en la Maestra IA (misma regla que Pulso ABM). Requiere sesión.
export async function GET() {
  const { data: clients, error } = await supabaseAdmin().from("clients").select("id, name, slug").eq("is_active", true).order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    const rows = await readMasterClients();
    const active = (clients ?? []).filter((c: { id: string; name: string; slug: string | null }) => findMasterRow(rows, c)?.active);
    return NextResponse.json({ clients: active.map((c) => ({ id: c.id, name: c.name })) });
  } catch {
    // Sin Maestra: todos los clientes activos de la app
    return NextResponse.json({ clients: (clients ?? []).map((c) => ({ id: c.id, name: c.name })), warning: "No se pudo leer la Maestra: se muestran todos los clientes activos de la app." });
  }
}
