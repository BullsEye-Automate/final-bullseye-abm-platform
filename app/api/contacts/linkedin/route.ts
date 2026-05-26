import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Columnas necesarias para la vista de LinkedIn outreach
const LINKEDIN_COLUMNS =
  "id, company_id, first_name, last_name, job_title, linkedin_url, linkedin_icebreaker, status, updated_at, created_at";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  const bucket = req.nextUrl.searchParams.get("bucket");
  const status = req.nextUrl.searchParams.get("status");

  const db = supabaseAdmin();

  // Siempre requerimos que linkedin_url esté presente
  let q = db
    .from("contacts")
    .select(LINKEDIN_COLUMNS)
    .not("linkedin_url", "is", null);

  // Filtrar por cliente si se provee
  if (clientId) {
    q = q.eq("client_id", clientId);
  }

  // Bucket "linkedin_pending": contactos enriquecidos listos para outreach
  // fit_action='enrich', no descartados, no contactados, no respondidos
  if (bucket === "linkedin_pending") {
    q = q
      .eq("fit_action", "enrich")
      .not("status", "in", '("discarded","contacted","replied")');
  } else if (status) {
    // Filtrar por status específico: 'contacted', 'replied', etc.
    q = q.eq("status", status);
  }

  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enriquecer con nombre de empresa si hay company_id
  const contacts = data ?? [];
  if (contacts.length === 0) {
    return NextResponse.json({ contacts: [] });
  }

  // Obtener company_ids únicos para hacer un join manual
  const companyIds = [...new Set(contacts.map((c) => c.company_id).filter(Boolean))] as string[];

  let companyMap: Record<string, string> = {};
  if (companyIds.length > 0) {
    const { data: companies } = await db
      .from("companies")
      .select("id, company_name")
      .in("id", companyIds);

    if (companies) {
      for (const co of companies as { id: string; company_name: string }[]) {
        companyMap[co.id] = co.company_name;
      }
    }
  }

  // Añadir company_name a cada contacto
  const enriched = contacts.map((c) => ({
    ...c,
    company_name: c.company_id ? (companyMap[c.company_id as string] ?? null) : null
  }));

  return NextResponse.json({ contacts: enriched });
}
