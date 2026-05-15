import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/sales-navigator
//
// Lista las empresas que Clay no pudo prospectar (clay_no_contacts_at
// seteado por el loop de feedback del PR #91), para el módulo
// /sales-navigator. Las separa en dos buckets según sales_nav_status:
//   - pending : null      → falta revisarlas en LinkedIn Sales Navigator
//   - no_fit  : 'no_fit'   → revisadas, sin contactos fit
const COMPANY_COLS =
  "id, company_name, company_website, company_linkedin_url, company_city, " +
  "company_country, company_size, company_type, cad_software, scanner_technology, " +
  "fit_signals, fit_score, research_summary, clay_no_contacts_at, sales_nav_status, " +
  "sales_nav_checked_at, created_at";

export async function GET() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("companies")
    .select(COMPANY_COLS)
    .not("clay_no_contacts_at", "is", null)
    .order("clay_no_contacts_at", { ascending: false })
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const all = (data ?? []) as unknown as Array<{ sales_nav_status: string | null }>;
  const pending = all.filter((c) => !c.sales_nav_status);
  const no_fit = all.filter((c) => c.sales_nav_status === "no_fit");

  return NextResponse.json(
    {
      pending,
      no_fit,
      counts: { pending: pending.length, no_fit: no_fit.length }
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
