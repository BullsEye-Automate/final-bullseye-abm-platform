import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/contacts/search?linkedin_url={url}&client_id={id}
 *
 * Busca un contacto en Supabase por linkedin_url (normalizada).
 * Retorna el contacto con el nombre de la empresa si lo encuentra,
 * o { found: false } si no.
 */
export async function GET(req: NextRequest) {
  const rawUrl  = req.nextUrl.searchParams.get("linkedin_url");
  const clientId = req.nextUrl.searchParams.get("client_id") || null;

  if (!rawUrl?.trim()) {
    return NextResponse.json(
      { error: "Se requiere el parámetro linkedin_url" },
      { status: 400 }
    );
  }

  // Normalizar la URL antes de buscar
  const normalizedUrl = normalizeLinkedInUrl(rawUrl);
  if (!normalizedUrl) {
    return NextResponse.json(
      { error: "URL de LinkedIn inválida" },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();

  // Construir query con join a companies para obtener company_name
  let q = db
    .from("contacts")
    .select(
      "id, first_name, last_name, job_title, linkedin_url, email, phone, phone_source, company_id, companies(company_name)"
    )
    .ilike("linkedin_url", normalizedUrl);

  if (clientId) {
    q = q.eq("client_id", clientId);
  }

  const { data, error } = await q.maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ found: false });
  }

  // Extraer company_name del join
  const companyRow = data.companies as any;
  const companyName: string | null =
    Array.isArray(companyRow)
      ? (companyRow[0]?.company_name ?? null)
      : (companyRow?.company_name ?? null);

  return NextResponse.json({
    found: true,
    contact: {
      id:           data.id,
      first_name:   data.first_name,
      last_name:    data.last_name,
      job_title:    data.job_title,
      linkedin_url: data.linkedin_url,
      email:        data.email,
      phone:        data.phone,
      phone_source: data.phone_source,
      company_name: companyName,
    },
  });
}
