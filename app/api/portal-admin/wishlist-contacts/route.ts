import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getReviewerEmail } from "@/lib/portalAdmin";
import {
  approveWishlistContact,
  FEW_CONTACTS,
  MAX_CONTACTS,
  refreshEnrichments,
  rejectWishlistContact,
  searchWishlistContacts,
} from "@/lib/wishlistContacts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET ?client_id= — empresas de la wishlist del cliente con sus contactos sugeridos / revisados
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Falta client_id" }, { status: 400 });
  const db = supabaseAdmin();
  const [{ data: items, error }, { data: contacts }] = await Promise.all([
    db
      .from("client_wishlist")
      .select("id, company_name, domain, linkedin_url, status, fit_score, lemlist_status, contacts_status, contacts_found, contacts_searched_at, contacts_error, contacts_debug, created_at")
      .eq("client_id", clientId)
      .neq("status", "discarded")
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("wishlist_contacts")
      .select("id, wishlist_id, full_name, title, linkedin_url, location, seniority, department, fit_score, buying_role, fit_reason, status, reject_reason, reviewed_by_email, lemlist_contact_id, lemlist_error, enrich_status, email, phone")
      .eq("client_id", clientId)
      .order("fit_score", { ascending: false })
      .limit(5000),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    { items: items ?? [], contacts: contacts ?? [], max_contacts: MAX_CONTACTS, few_contacts: FEW_CONTACTS },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

// POST
//   { action: "search", wishlist_id }          busca contactos de UNA empresa (el navegador recorre la selección)
//   { action: "approve" | "reject", contact_id, reason? }
//   { action: "refresh", client_id }           revisa emails / teléfonos pendientes
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const db = supabaseAdmin();
  try {
    switch (body?.action) {
      case "search": {
        if (typeof body.wishlist_id !== "string") return NextResponse.json({ error: "Falta wishlist_id" }, { status: 400 });
        return NextResponse.json(await searchWishlistContacts(db, body.wishlist_id));
      }
      case "approve": {
        if (typeof body.contact_id !== "string") return NextResponse.json({ error: "Falta contact_id" }, { status: 400 });
        return NextResponse.json(await approveWishlistContact(db, body.contact_id, await getReviewerEmail()));
      }
      case "reject": {
        if (typeof body.contact_id !== "string") return NextResponse.json({ error: "Falta contact_id" }, { status: 400 });
        const reason = typeof body.reason === "string" ? body.reason.trim() : null;
        const { error } = await rejectWishlistContact(db, body.contact_id, reason, await getReviewerEmail());
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
      }
      case "refresh": {
        if (typeof body.client_id !== "string") return NextResponse.json({ error: "Falta client_id" }, { status: 400 });
        return NextResponse.json(await refreshEnrichments(db, body.client_id));
      }
      default:
        return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }
  } catch (err) {
    console.error("wishlist-contacts:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error inesperado" }, { status: 500 });
  }
}
