import { NextRequest, NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { canMarkBilling, setBillingMark } from "@/lib/dashboardSdr/billing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Dashboard SDR — marca "Para facturar" de una reunión, con trazabilidad
// (quién y cuándo). POST { id: <meetings.id>, value: boolean }.
// Es una marca personal de Ingri para contar reuniones (lib/dashboardSdr/billing.ts):
// no cambia nada en la facturación ni en la planilla.
// Se guarda en allo_response_cache (sin migración).
export async function POST(req: NextRequest) {
  try {
    const email = await currentUserEmail();
    if (!email) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    const b = await req.json().catch(() => null);
    const id = String(b?.id ?? "");
    const value = b?.value === true;
    if (!id) return NextResponse.json({ error: "Falta el id de la reunión" }, { status: 400 });

    if (!canMarkBilling(email)) return NextResponse.json({ error: "Esta marca es solo para facturación interna." }, { status: 403 });

    await setBillingMark(id, value, email);
    return NextResponse.json({ ok: true, value });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
