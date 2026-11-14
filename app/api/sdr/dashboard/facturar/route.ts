import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { canMarkBilling } from "@/lib/dashboardSdr/billing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Dashboard SDR — marca "Para facturar" de una reunión, con trazabilidad
// (quién y cuándo). POST { id: <meetings.id>, value: boolean }.
// Es una marca personal de Ingri para contar reuniones (lib/dashboardSdr/billing.ts):
// no cambia nada en la facturación ni en la planilla.
// Requiere supabase/20261114_meetings_facturar.sql.
export async function POST(req: NextRequest) {
  try {
    const email = await currentUserEmail();
    if (!email) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    const b = await req.json().catch(() => null);
    const id = String(b?.id ?? "");
    const value = b?.value === true;
    if (!id) return NextResponse.json({ error: "Falta el id de la reunión" }, { status: 400 });

    if (!canMarkBilling(email)) return NextResponse.json({ error: "Esta marca es solo para facturación interna." }, { status: 403 });

    const { error } = await supabaseAdmin().from("meetings")
      .update({ facturar: value, facturar_by: email, facturar_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      const missing = /facturar/.test(error.message);
      return NextResponse.json({ error: missing ? "Falta ejecutar la migración supabase/20261114_meetings_facturar.sql en Supabase." : error.message }, { status: missing ? 400 : 500 });
    }
    return NextResponse.json({ ok: true, value });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
