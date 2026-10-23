import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWishlistActor } from "@/lib/portalAuth";

export const dynamic = "force-dynamic";

const WISHLIST_LABEL: Record<string, string> = {
  new: "Aprobada · enviando a Lemlist",
  in_lemlist: "En Lemlist · buscando contactos",
  in_progress: "En prospección",
  contacts_found: "Contactos encontrados",
};

// GET — empresas que BullsEye ya está trabajando para el cliente:
//  - companies aprobadas para prospección (approved / client_approved)
//  - empresas de su wishlist que prospección marcó en curso o con contactos
// Solo datos básicos: nunca el research ni las notas internas.
// Las de la wishlist van primero (son las más recientes del flujo nuevo).
export async function GET(req: NextRequest) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;
  const db = supabaseAdmin();

  const items: { name: string; website: string | null; country: string | null; since: string | null; origin: "prospeccion" | "wishlist"; status: string }[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await db
      .from("companies")
      .select("company_name, company_website, company_country, approved_at, updated_at, status")
      .eq("client_id", user.clientId)
      .in("status", ["approved", "client_approved"])
      .order("updated_at", { ascending: false })
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const c of data ?? []) {
      items.push({
        name: c.company_name,
        website: c.company_website,
        country: c.company_country,
        since: c.approved_at ?? c.updated_at,
        origin: "prospeccion",
        status: "En prospección",
      });
    }
    if (!data || data.length < 1000) break;
  }

  const { data: wl } = await db
    .from("client_wishlist")
    .select("company_name, domain, status, updated_at")
    .eq("client_id", user.clientId)
    // El operador (Empresas → Aprobadas) ve también las recién aprobadas
    .in("status", user.isOperator ? ["new", "in_lemlist", "in_progress", "contacts_found"] : ["in_progress", "contacts_found"]);
  const seen = new Set(items.map((i) => i.name.toLowerCase()));
  const fromWishlist: typeof items = [];
  for (const w of wl ?? []) {
    if (seen.has(w.company_name.toLowerCase())) continue;
    fromWishlist.push({
      name: w.company_name,
      website: w.domain,
      country: null,
      since: w.updated_at,
      origin: "wishlist",
      status: WISHLIST_LABEL[w.status] ?? "En prospección",
    });
  }

  return NextResponse.json({ items: [...fromWishlist, ...items] });
}
