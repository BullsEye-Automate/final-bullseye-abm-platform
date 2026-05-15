import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { intakeContactsForCompany, type RawContact } from "@/lib/contactsIntake";
import { getCampaignLeads } from "@/lib/lemlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pre-filtro de Claude por cada contacto — puede tardar con varios.
export const maxDuration = 300;

// POST /api/sales-navigator/[id]/import   ([id] = company id, sin body)
//   ?all=1 → importa TODOS los leads de la campaña puente a esta empresa,
//            sin filtrar por nombre (escape hatch para cuando el match por
//            nombre falla — la campaña puente se trabaja una empresa a la vez).
//
// Jala los leads de la campaña "puente" de Lemlist (LEMLIST_STAGING_CAMPAIGN_ID),
// por defecto filtra los que matchean el nombre de esta empresa, y los importa
// por el pipeline compartido intakeContactsForCompany (pre-filtro Claude +
// dedup + insert). El dedup por linkedin_url / email hace que re-correr esto
// solo procese los NUEVOS.
//
// Devuelve siempre `staged_leads` (muestra de lo que hay en la campaña puente)
// y `matched_url` para diagnosticar si el match o el fetch fallan.

function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Match laxo por nombre: igual, o uno contiene al otro (con piso de 4 chars
// para no matchear por fragmentos genéricos tipo "lab").
function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 4 && longer.includes(shorter);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const stagingId = process.env.LEMLIST_STAGING_CAMPAIGN_ID;
  if (!stagingId) {
    return NextResponse.json(
      {
        error:
          "Falta LEMLIST_STAGING_CAMPAIGN_ID en Vercel — es el ID de la campaña puente de Lemlist."
      },
      { status: 500 }
    );
  }

  const importAll = req.nextUrl.searchParams.get("all") === "1";

  const db = supabaseAdmin();
  const { data: company, error: cErr } = await db
    .from("companies")
    .select("id, company_name")
    .eq("id", params.id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!company) {
    return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  }

  const leadsRes = await getCampaignLeads(stagingId);
  if (!leadsRes.ok) {
    return NextResponse.json(
      {
        error: `No se pudieron leer los leads de la campaña puente: ${leadsRes.error}`,
        debug: leadsRes.debug
      },
      { status: 502 }
    );
  }

  const allStaged = leadsRes.leads;
  const target = normName(company.company_name);
  const nameMatched = allStaged.filter((l) =>
    namesMatch(normName(l.company_name), target)
  );

  // Muestra de lo que hay en la campaña puente — para que la UI lo muestre y
  // para diagnosticar si el fetch o el match fallan.
  const stagedLeads = allStaged.slice(0, 30).map((l) => ({
    name: [l.first_name, l.last_name].filter(Boolean).join(" ") || null,
    company_name: l.company_name,
    job_title: l.job_title,
    linkedin_url: l.linkedin_url
  }));

  const toImport = importAll ? allStaged : nameMatched;

  if (toImport.length === 0) {
    return NextResponse.json({
      ok: true,
      summary: { inserted: 0, yes: 0, no: 0, skipped: 0 },
      contacts: [],
      staged_total: allStaged.length,
      matched: nameMatched.length,
      staged_leads: stagedLeads,
      matched_url: leadsRes.matched_url
    });
  }

  const contacts: RawContact[] = toImport.map((l) => ({
    first_name: l.first_name,
    last_name: l.last_name,
    job_title: l.job_title,
    linkedin_headline: null,
    linkedin_url: l.linkedin_url,
    email: l.email
  }));

  const result = await intakeContactsForCompany(db, params.id, contacts);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Contactos YES de esta empresa listos para Lemlist (recién importados o
  // leftover de un import previo sin pushear todavía).
  const { data: fresh } = await db
    .from("contacts")
    .select(
      "id, first_name, last_name, job_title, linkedin_url, email, prefilter_result, " +
        "status, fit_action, lemlist_pushed_at, lemlist_push_error, clay_pushed_at, created_at"
    )
    .eq("company_id", params.id)
    .eq("prefilter_result", "yes")
    .is("lemlist_pushed_at", null)
    .is("clay_pushed_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    ok: true,
    summary: result.summary,
    contacts: fresh ?? [],
    staged_total: allStaged.length,
    matched: nameMatched.length,
    imported_from: importAll ? "all" : "name_match",
    staged_leads: stagedLeads,
    matched_url: leadsRes.matched_url
  });
}
