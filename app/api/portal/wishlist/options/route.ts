import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";
import { isFilterableProperty, listPoolProperties } from "@/lib/hubspotPool";
import { getClientOwnLemlistKey, getLemlistCompanyFilters, lemlistFilterLabel } from "@/lib/lemlistDatabase";

export const dynamic = "force-dynamic";

// GET — filtros disponibles para cada fuente de la wishlist
export async function GET() {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  const db = supabaseAdmin();

  const [properties, { count: poolSize }, lemlistKey] = await Promise.all([
    listPoolProperties(db),
    db.from("hubspot_company_pool").select("hs_id", { count: "exact", head: true }),
    getClientOwnLemlistKey(db, user.clientId),
  ]);

  let lemlist: { available: boolean; reason?: string; filters?: unknown[] } = {
    available: false,
    reason: "Tu cuenta de Lemlist aún no está conectada. Pídelo a tu ejecutivo de BullsEye.",
  };
  if (lemlistKey) {
    const r = await getLemlistCompanyFilters(lemlistKey);
    lemlist = r.ok
      ? {
          available: true,
          // keywordInCompany se usa vía el buscador de texto; el resto como filtros
          filters: r.data
            .filter((f) => f.filterId !== "keywordInCompany")
            .map((f) => ({ ...f, description: lemlistFilterLabel(f) })),
        }
      : { available: false, reason: `No pudimos conectar con Lemlist (${r.status || "sin respuesta"}).` };
  }

  return NextResponse.json({
    hubspot: {
      available: (poolSize ?? 0) > 0,
      reason: (poolSize ?? 0) > 0 ? undefined : "La base de BullsEye se está preparando.",
      total: poolSize ?? 0,
      // Solo propiedades útiles para filtrar: listas con opciones o números
      properties: properties
        .filter((p) => isFilterableProperty(p.name) && (p.type === "number" || p.options.length > 0))
        .map((p) => ({ name: p.name, label: p.label, type: p.type, options: p.options, filled_count: p.filled_count })),
    },
    lemlist,
  });
}
