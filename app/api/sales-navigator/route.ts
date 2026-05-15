import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/sales-navigator
//
// Empresas que pasaron por Clay y necesitan revisión manual en LinkedIn
// Sales Navigator porque Clay encontró pocos contactos. Tres buckets:
//
//   - no_contacts : 0 contactos en nuestra base. Clay no encontró a nadie.
//                   Aplica gracia de 24h si Clay todavía puede estar
//                   procesando (se puede deshabilitar con ?include_recent=1).
//   - one_contact : exactamente 1 contacto. Clay encontró solo uno —
//                   conviene buscar más en Sales Nav.
//   - no_fit      : sales_nav_status='no_fit' (trabajada y descartada
//                   porque no había nadie fit en LinkedIn).
//
// Universo: empresas con clay_pushed_at != null.

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

  // Conteo de contactos por empresa.
  const { data: contactRows, error: cErr } = await db
    .from("contacts")
    .select("company_id");
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  const countByCompany = new Map<string, number>();
  for (const r of contactRows ?? []) {
    const id = r.company_id as string | null;
    if (!id) continue;
    countByCompany.set(id, (countByCompany.get(id) ?? 0) + 1);
  }

  // Para no_contacts aplicamos gracia (Clay puede seguir procesando).
  // Para one_contact NO aplica gracia: 1 ya significa que Clay devolvió.
  const graceMs = includeRecent ? 0 : CLAY_GRACE_HOURS * 60 * 60 * 1000;
  const now = Date.now();

  const no_contacts: Array<Row & { signal: "clay" | "inferred"; contact_count: number }> = [];
  const one_contact: Array<Row & { contact_count: number }> = [];
  const no_fit: Row[] = [];

  for (const c of companies) {
    if (c.sales_nav_status === "no_fit") {
      no_fit.push(c);
      continue;
    }
    if (c.sales_nav_status) continue; // estado futuro desconocido: ignorar

    const count = countByCompany.get(c.id) ?? 0;

    if (count === 1) {
      one_contact.push({ ...c, contact_count: 1 });
      continue;
    }
    if (count >= 2) {
      // Ya tiene 2+ contactos — fuera del módulo de revisión manual.
      continue;
    }

    // count === 0
    if (c.clay_no_contacts_at) {
      // Señal precisa de Clay.
      no_contacts.push({ ...c, signal: "clay", contact_count: 0 });
      continue;
    }
    if (
      c.clay_pushed_at &&
      now - new Date(c.clay_pushed_at).getTime() > graceMs
    ) {
      // Señal inferida: pasó la gracia y sigue sin contactos.
      no_contacts.push({ ...c, signal: "inferred", contact_count: 0 });
    }
  }

  const sortByMostRecent = <T extends Row>(a: T, b: T) => {
    const at = a.clay_no_contacts_at ?? a.clay_pushed_at ?? "";
    const bt = b.clay_no_contacts_at ?? b.clay_pushed_at ?? "";
    return bt.localeCompare(at);
  };
  no_contacts.sort(sortByMostRecent);
  one_contact.sort(sortByMostRecent);

  return NextResponse.json(
    {
      no_contacts,
      one_contact,
      no_fit,
      counts: {
        no_contacts: no_contacts.length,
        one_contact: one_contact.length,
        no_fit: no_fit.length
      },
      grace_hours: CLAY_GRACE_HOURS,
      include_recent: includeRecent
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
