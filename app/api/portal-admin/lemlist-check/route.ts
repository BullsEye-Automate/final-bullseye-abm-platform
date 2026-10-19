import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getClientOwnLemlistKey, getLemlistCompanyFilters, searchLemlistCompanies } from "@/lib/lemlistDatabase";

export const dynamic = "force-dynamic";

// GET ?client_id= — diagnóstico de la base de Lemlist con la key del cliente:
// confirma que la key funciona, qué filtros de empresas expone y si la
// búsqueda de empresas responde (y con qué campos).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "client_id requerido" }, { status: 400 });

  const apiKey = await getClientOwnLemlistKey(supabaseAdmin(), clientId);
  if (!apiKey) return NextResponse.json({ has_key: false });

  const filters = await getLemlistCompanyFilters(apiKey);
  const search = await searchLemlistCompanies(apiKey, {
    filters: [{ filterId: "keywordInCompany", in: ["software"] }],
    page: 1,
    size: 3,
  });

  return NextResponse.json({
    has_key: true,
    filters: filters.ok
      ? { ok: true, count: filters.data.length, sample: filters.data.slice(0, 40).map((f) => ({ filterId: f.filterId, description: f.description, type: f.type, values: f.values?.length ?? 0 })) }
      : { ok: false, status: filters.status, error: filters.error },
    search: search.ok
      ? {
          ok: true,
          total: search.data.total,
          raw_keys: search.data.rawKeys,
          sample: search.data.companies,
          raw_first: JSON.stringify(search.data.rawSample).slice(0, 3000),
        }
      : { ok: false, status: search.status, error: search.error },
  });
}
