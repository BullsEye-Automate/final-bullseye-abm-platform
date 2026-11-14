import { NextRequest, NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { canMarkBilling, loadBillingMarks, PULSO_BILLING_PREFIX, setBillingMark } from "@/lib/dashboardSdr/billing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Pulso ABM (vista interna) → Detalle de reuniones: marca «Por facturar» de
// cada reunión de la planilla, con trazabilidad (quién y cuándo). Solo para
// las personas de facturación (canMarkBilling); al resto le responde
// canBill=false y no ve la columna. Es solo una marca para contar: no cambia
// la planilla. Distinta de «Reunión comisionable» del Dashboard SDR.
// GET → { canBill, marks: { <meetings.id>: { value, by, at } } } · POST { id, value }
export async function GET() {
  const email = await currentUserEmail();
  if (!canMarkBilling(email)) return NextResponse.json({ canBill: false, marks: {} });
  try {
    return NextResponse.json({ canBill: true, marks: Object.fromEntries(await loadBillingMarks(PULSO_BILLING_PREFIX)) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const email = await currentUserEmail();
    if (!email) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    if (!canMarkBilling(email)) return NextResponse.json({ error: "Esta marca es solo para facturación interna." }, { status: 403 });
    const b = await req.json().catch(() => null);
    const id = String(b?.id ?? "").replace(/@\d+$/, "");
    if (!id) return NextResponse.json({ error: "Falta el id de la reunión" }, { status: 400 });
    const mark = await setBillingMark(id, b?.value === true, email, PULSO_BILLING_PREFIX);
    return NextResponse.json({ ok: true, mark });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
