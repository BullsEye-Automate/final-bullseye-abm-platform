import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/sales-navigator
//
// Lista las empresas que necesitan revisión manual en LinkedIn Sales
// Navigator porque Clay no les encontró contactos. Hay DOS señales:
//
//   1. SEÑAL PRECISA (clay_no_contacts_at): el loop del PR #91 — Clay
//      avisa por webhook cuando Find People da 0. Requiere una columna
//      HTTP API en Clay, que ahora quedó detrás del plan Growth (las
//      columnas viejas siguen andando porque están grandfathered).
//
//   2. SEÑAL INFERIDA: como crear esa columna ya no se puede sin upgrade,
//      la app lo deduce sola — una empresa empujada a Clay hace más de
//      CLAY_GRACE_HOURS que todavía no tiene NINGÚN contacto en nuestra
//      base = Clay no encontró a nadie (si hubiera encontrado, el webhook
//      raw-contacts ya habría creado las filas de contacto).
//
// El query param ?include_recent=1 baja la gracia a 0: trae TODAS las
// empresas que pasaron por Clay y siguen sin contactos, sin esperar las
// 24h (botón "Incluir las recién mandadas a Clay" en la UI).
//
// Buckets:
//   - pending : sales_nav_status null + (señal precisa O inferida)
//   - no_fit  : sales_nav_status = 'no_fit'
//
// Toda empresa que pasó por el módulo tiene clay_pushed_at seteado
// (clay_no_contacts_at y sales_nav_status solo se setean sobre empresas
// que fueron empujadas a Clay), así que con ese filtro alcanza.

const CLAY_GRACE_HOURS = 24;

const COMPANY_COLS =
  "id, company_name, company_website, company_linkedin_url, company_city, " +
  "company_country, company_size, company_type, cad_software, scanner_technology, " +
  "fit_signals, fit_score, research_summary, clay_pushed_at, clay_no_contacts_at, " +
  "sales_nav_status, sales_nav_checked_at, created_at";

type Row = {
  id: string;
  clay_pushed_at: string | null;
  clay_no_contacts_at: string | null;
  sales_nav_status: string | null;
  [k: string]: unknown;
};

export async function GET(req: NextRequest) {
  const includeRecent = req.nextUrl.searchParams.get("include_recent") === "1";
  const db = supabaseAdmin();

  // Universo: empresas que pasaron por Clay.
  const { data, error } = await db
    .from("companies")
    .select(COMPANY_COLS)
    .not("clay_pushed_at", "is", null)
    .order("clay_pushed_at", { ascending: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const companies = (data ?? []) as unknown as Row[];

  // company_ids que ya tienen al menos un contacto en nuestra base.
  const { data: contactRows, error: cErr } = await db
    .from("contacts")
    .select("company_id");
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  const withContacts = new Set(
    (contactRows ?? []).map((r) => r.company_id as string).filter(Boolean)
  );

  // include_recent=1 → gracia 0: cualquier empresa que pasó por Clay y
  // sigue sin contactos, sin importar cuán reciente sea el push.
  const graceMs = includeRecent ? 0 : CLAY_GRACE_HOURS * 60 * 60 * 1000;
  const now = Date.now();

  const pending: Array<Row & { signal: "clay" | "inferred" }> = [];
  const no_fit: Row[] = [];

  for (const c of companies) {
    if (c.sales_nav_status === "no_fit") {
      no_fit.push(c);
      continue;
    }
    if (c.sales_nav_status) continue; // estado futuro desconocido: ignorar

    // Señal precisa: Clay avisó por webhook.
    if (c.clay_no_contacts_at) {
      pending.push({ ...c, signal: "clay" });
      continue;
    }
    // Señal inferida: empujada a Clay hace rato y todavía sin contactos.
    if (
      c.clay_pushed_at &&
      now - new Date(c.clay_pushed_at).getTime() > graceMs &&
      !withContacts.has(c.id)
    ) {
      pending.push({ ...c, signal: "inferred" });
    }
  }

  // Más recientes primero (por la fecha más relevante de cada una).
  pending.sort((a, b) => {
    const at = a.clay_no_contacts_at ?? a.clay_pushed_at ?? "";
    const bt = b.clay_no_contacts_at ?? b.clay_pushed_at ?? "";
    return bt.localeCompare(at);
  });

  return NextResponse.json(
    {
      pending,
      no_fit,
      counts: { pending: pending.length, no_fit: no_fit.length },
      grace_hours: CLAY_GRACE_HOURS,
      include_recent: includeRecent
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
