import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/sales-navigator/[id]/mark   ([id] = company id)
//   body { status: "no_fit" | null }
//
//   "no_fit" → la empresa no tiene contactos fit en Sales Navigator. Sale de
//              la cola "Por revisar" y pasa a "Sin contactos fit".
//   null     → reactiva la empresa (vuelve a "Por revisar").
//
// No toca clay_no_contacts_at ni el status de la empresa — la empresa sigue
// siendo válida, solo que no se le encontró gente fit.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}));
  const status = (body as { status?: unknown }).status;
  if (status !== "no_fit" && status !== null) {
    return NextResponse.json(
      { error: 'status debe ser "no_fit" o null' },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("companies")
    .update({
      sales_nav_status: status,
      sales_nav_checked_at: status ? new Date().toISOString() : null
    })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, status });
}
