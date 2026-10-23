import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET ?client_id= — contactos del flujo anterior de prospección (tabla
// contacts) del cliente, solo lectura, para verlos junto a los del flujo nuevo
// en Contactos. Los descartados no se muestran.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Falta client_id" }, { status: 400 });
  const { data, error } = await supabaseAdmin()
    .from("contacts")
    .select("id, first_name, last_name, job_title, linkedin_url, email, phone, status, fit_score, hubspot_contact_id, created_at, companies(company_name)")
    .eq("client_id", clientId)
    .neq("status", "discarded")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const contacts = (data ?? []).map(({ companies, ...c }) => ({
    ...c,
    company_name: (Array.isArray(companies) ? companies[0] : companies)?.company_name ?? null,
  }));
  return NextResponse.json({ contacts }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
