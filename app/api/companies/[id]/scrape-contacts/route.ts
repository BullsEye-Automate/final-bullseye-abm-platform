import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { scrapeCompanyContacts } from "@/lib/websiteContacts";
import { intakeContactsForCompany } from "@/lib/contactsIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/companies/[id]/scrape-contacts
//
// Scrapea la página de equipo del sitio web de la empresa, extrae las
// personas (nombre, cargo, email, teléfono) y las mete por el pipeline de
// contactos de siempre (pre-filter + dedup + insert). Útil para labs que
// tienen su equipo en la web pero no en LinkedIn (Clay rinde cero ahí).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: company, error: cErr } = await db
    .from("companies")
    .select("id, company_name, company_website")
    .eq("id", params.id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  if (!company.company_website) {
    return NextResponse.json(
      { error: "Esta empresa no tiene sitio web cargado. No se puede scrapear." },
      { status: 400 }
    );
  }

  let scrape;
  try {
    scrape = await scrapeCompanyContacts({
      company_name: company.company_name,
      company_website: company.company_website
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Scrape failed";
    const overloaded = /overloaded/i.test(raw) || /\b529\b/.test(raw);
    return NextResponse.json(
      {
        error: overloaded
          ? "Anthropic API saturada (529). Reintentá en 30-60 segundos."
          : raw
      },
      { status: overloaded ? 503 : 500 }
    );
  }

  if (scrape.contacts.length === 0) {
    return NextResponse.json({
      ok: true,
      found: 0,
      summary: { inserted: 0, yes: 0, no: 0, skipped: 0 },
      message:
        "No se encontraron personas nombradas en el sitio web. Puede que la empresa no tenga página de equipo pública.",
      diagnostics: scrape.diagnostics
    });
  }

  const intake = await intakeContactsForCompany(db, params.id, scrape.contacts);
  if (!intake.ok) {
    return NextResponse.json({ error: intake.error }, { status: intake.status });
  }

  return NextResponse.json({
    ok: true,
    found: scrape.contacts.length,
    summary: intake.summary,
    diagnostics: scrape.diagnostics
  });
}
