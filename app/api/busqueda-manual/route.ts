import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getReviewerEmail } from "@/lib/portalAdmin";
import { addManualContact, listManualQueue, MANUAL_STATUSES, setManualStatus, type ManualStatus } from "@/lib/manualProspecting";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET ?client_id=<id | __all__>&view=open|closed — empresas con pocos contactos
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("client_id");
  const clientId = !raw || raw === "__all__" ? null : raw;
  const view = req.nextUrl.searchParams.get("view") === "closed" ? "closed" : "open";
  try {
    return NextResponse.json(await listManualQueue(supabaseAdmin(), { clientId, view }), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error inesperado" }, { status: 500 });
  }
}

// POST
//   { action: "status", wishlist_id, manual_status }
//   { action: "add_contact", wishlist_id, full_name, title?, linkedin_url?, email?, phone? }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (typeof body?.wishlist_id !== "string") return NextResponse.json({ error: "Falta wishlist_id" }, { status: 400 });
  const db = supabaseAdmin();
  const email = await getReviewerEmail();
  try {
    switch (body.action) {
      case "status": {
        if (!MANUAL_STATUSES.includes(body.manual_status)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
        await setManualStatus(db, body.wishlist_id, body.manual_status as ManualStatus, email);
        return NextResponse.json({ ok: true });
      }
      case "add_contact": {
        if (typeof body.full_name !== "string") return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });
        const r = await addManualContact(db, body.wishlist_id, body, email);
        return r.id ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 400 });
      }
      default:
        return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error inesperado" }, { status: 500 });
  }
}
