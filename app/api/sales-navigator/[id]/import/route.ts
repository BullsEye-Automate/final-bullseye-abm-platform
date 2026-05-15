import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { intakeContactsForCompany, type RawContact } from "@/lib/contactsIntake";
import { getCampaignLeadsWithDetails, deleteCampaignLead } from "@/lib/lemlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pre-filtro de Claude por cada contacto + DELETEs a Lemlist al final.
export const maxDuration = 300;

// POST /api/sales-navigator/[id]/import
//   body { lemlist_lead_ids: string[] }
//
// Importa los leads SELECCIONADOS de la Campaña puente a esta empresa.
// La UI le pasa los lemlist `_id`s que el usuario marcó en el preview con
// checkboxes. Luego de un intake exitoso, borra esos mismos leads de la
// Campaña puente en Lemlist (DELETE) para que la puente quede limpia
// entre empresas — los unselected quedan en la puente para procesarlos
// con otra empresa después.
//
// El dedup por linkedin_url/email a nivel empresa (intakeContactsForCompany)
// hace que re-importar el mismo lead a la misma empresa no duplique.
//
// Los DELETEs son best-effort: si fallan, el contacto ya quedó en Supabase
// y la respuesta incluye delete_errors para que la UI los muestre.
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

  const body = await req.json().catch(() => ({}));
  const rawIds = (body as { lemlist_lead_ids?: unknown }).lemlist_lead_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "Falta lemlist_lead_ids — ningún lead seleccionado para importar."
      },
      { status: 400 }
    );
  }
  const wantedIds = new Set(
    rawIds.filter(
      (x): x is string => typeof x === "string" && x.trim().length > 0
    )
  );
  if (wantedIds.size === 0) {
    return NextResponse.json(
      { error: "lemlist_lead_ids vacío después de validar." },
      { status: 400 }
    );
  }

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

  // Re-fetch fresco — la lista del preview puede haber cambiado.
  // getCampaignLeadsWithDetails: lista los leads + hace GET /api/leads/{id}
  // por cada uno para traer email/linkedinUrl/firstName/lastName/jobTitle/
  // companyName. El GET de lista directo solo devuelve {_id, state,
  // contactId} (probado vía /api/lemlist/diagnose-campaign) — sin esto, la
  // UI muestra "(sin nombre)" y el match por nombre de empresa es imposible.
  const leadsRes = await getCampaignLeadsWithDetails(stagingId);
  if (!leadsRes.ok) {
    return NextResponse.json(
      {
        error: `No se pudieron leer los leads de la campaña puente: ${leadsRes.error}`,
        debug: leadsRes.debug
      },
      { status: 502 }
    );
  }

  const selected = leadsRes.leads.filter((l) => l.id && wantedIds.has(l.id));
  if (selected.length === 0) {
    return NextResponse.json({
      ok: true,
      summary: { inserted: 0, yes: 0, no: 0, skipped: 0 },
      contacts: [],
      staged_total: leadsRes.leads.length,
      selected_count: 0,
      deleted: 0,
      delete_errors: [],
      matched_url: leadsRes.matched_url
    });
  }

  const contacts: RawContact[] = selected.map((l) => ({
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

  // Auto-limpiar la Campaña puente: DELETE de cada lead seleccionado.
  // Best-effort — errores se devuelven en delete_errors pero no rompen
  // la respuesta (el contacto ya quedó en Supabase).
  let deleted = 0;
  const delete_errors: { lead: string; error: string }[] = [];
  for (const l of selected) {
    if (!l.id && !l.email && !l.contact_id) continue;
    const del = await deleteCampaignLead(stagingId, {
      id: l.id,
      email: l.email,
      // contactId es el resource principal en Lemlist nuevo. Sin esto,
      // DELETE /campaigns/{id}/leads/{lea_xxx} y /leads/{lea_xxx} fallan
      // y los leads quedan acumulándose en la Campaña puente.
      contact_id: l.contact_id
    });
    if (del.ok) {
      deleted += 1;
    } else {
      const who =
        [l.first_name, l.last_name].filter(Boolean).join(" ") ||
        l.email ||
        l.id ||
        "(sin id)";
      delete_errors.push({ lead: who, error: del.error });
    }
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
    staged_total: leadsRes.leads.length,
    selected_count: selected.length,
    deleted,
    delete_errors,
    matched_url: leadsRes.matched_url
  });
}
