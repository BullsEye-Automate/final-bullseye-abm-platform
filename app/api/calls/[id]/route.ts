import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/calls/[id] — devuelve detalle completo de una llamada con
// joins a contacto + empresa + estado del análisis.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("calls")
    .select(
      "*, " +
        "contact:contacts(id, first_name, last_name, job_title, linkedin_url, email, phone, " +
        "  fit_score, fit_action, status, " +
        "  company:companies(id, company_name, company_type, company_size, cad_software)), " +
        "company:companies(id, company_name, company_type, company_size, cad_software)"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Call not found" }, { status: 404 });
  return NextResponse.json(data);
}
