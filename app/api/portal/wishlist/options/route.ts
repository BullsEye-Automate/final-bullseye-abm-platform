import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";
import { getClientOwnLemlistKey } from "@/lib/lemlistDatabase";
import { buildFilterCatalog } from "@/lib/unifiedSearch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET — catálogo de filtros unificados (en español) para la búsqueda de la
// wishlist. La primera vez puede tardar unos segundos: traduce con IA los
// valores de Lemlist y los deja cacheados.
export async function GET() {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  const db = supabaseAdmin();
  const key = await getClientOwnLemlistKey(db, user.clientId);
  const catalog = await buildFilterCatalog(db, key);
  // El navegador no necesita saber si hay Lemlist: solo qué filtros mostrar
  return NextResponse.json({ available: catalog.available, options: catalog.options });
}
